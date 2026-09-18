// Pure feature logic for lessons, question attempts and study sessions. Both the Cloud
// Functions and the browser demo call these with documents they have already read.
import { computeOutcome, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { gradeAnswer } from "./grading.js";
import { emptyMastery, mergeMastery } from "./mastery.js";
import type { Clock, WriteOp } from "./writes.js";
import type {
  ChapterProgressDoc, LessonDoc, LessonProgressDoc, QuestionDoc, QuestionKeyDoc, SessionKind, SubmittedAnswer, TopicMasteryDoc
} from "../types.js";

export class LogicError extends Error {
  constructor(public readonly code: "not-found" | "failed-precondition" | "invalid-argument" | "already-exists" | "permission-denied", message: string) {
    super(message);
    this.name = "LogicError";
  }
}

export const MAX_SESSION_MINUTES_PER_CALL = 60;
export const MAX_SESSION_MINUTES_PER_DAY = 600;
export const SESSION_KINDS: readonly SessionKind[] = ["learning", "practice", "revision", "buddy", "group"];

export interface CompleteLessonInput {
  ctx: OutcomeContext;
  clock: Clock;
  lesson: LessonDoc;
  progress: LessonProgressDoc | null;
  chapterProgress: ChapterProgressDoc | null;
  lessonsInChapter: number;
}

export interface CompleteLessonResult {
  alreadyCompleted: boolean;
  chapterCompleted: boolean;
  rewards: OutcomeResult | null;
}

/** Marks a lesson complete once, updates chapter progress and pays lesson (and chapter) rewards. */
export function completeLesson(input: CompleteLessonInput): { writes: WriteOp[]; result: CompleteLessonResult } {
  const { ctx, clock, lesson, progress, chapterProgress } = input;
  const uid = ctx.uid;
  if (ctx.eventDone || progress?.status === "completed") return { writes: [], result: { alreadyCompleted: true, chapterCompleted: false, rewards: null } };
  const writes: WriteOp[] = [];
  writes.push({
    path: `lessonProgress/${uid}_${lesson.id}`,
    data: { lessonId: lesson.id, userId: uid, topicId: lesson.topicId, chapterId: lesson.chapterId, subjectId: lesson.subjectId, status: "completed", startedAt: progress?.startedAt ?? clock.stamp, completedAt: clock.stamp }
  });
  const lessonsCompleted = (chapterProgress?.lessonsCompleted ?? 0) + 1;
  const chapterCompleted = !chapterProgress?.completed && input.lessonsInChapter > 0 && lessonsCompleted >= input.lessonsInChapter;
  writes.push({
    path: `chapterProgress/${uid}_${lesson.chapterId}`,
    merge: true,
    data: {
      id: `${uid}_${lesson.chapterId}`,
      userId: uid,
      chapterId: lesson.chapterId,
      subjectId: lesson.subjectId,
      classLevel: lesson.classLevel,
      lessonsTotal: input.lessonsInChapter,
      lessonsCompleted,
      completed: chapterProgress?.completed || chapterCompleted,
      completedAt: chapterCompleted ? clock.stamp : chapterProgress?.completedAt ?? null
    }
  });
  const outcome = computeOutcome(ctx, {
    eventId: `lesson_${uid}_${lesson.id}`,
    reason: chapterCompleted ? "chapter_completed" : "lesson_completed",
    refId: lesson.id,
    xp: ctx.config.lessonXp + (chapterCompleted ? ctx.config.chapterCompleteXp : 0),
    coins: chapterCompleted ? ctx.config.chapterCompleteCoins : 0,
    activity: { lessons: 1, topicIds: [lesson.topicId] },
    stats: { lessonsCompleted: 1, chaptersCompleted: chapterCompleted ? 1 : 0 }
  }, clock);
  writes.push(...outcome.writes);
  return { writes, result: { alreadyCompleted: false, chapterCompleted, rewards: outcome.result } };
}

export interface SubmitAnswerInput {
  ctx: OutcomeContext;
  clock: Clock;
  attemptId: string;
  question: QuestionDoc;
  key: QuestionKeyDoc;
  answer: SubmittedAnswer;
  timeTakenSec: number;
  context: "practice" | "topic";
  mastery: TopicMasteryDoc | null;
  priorAttempts: number;
  solvedBefore: boolean;
  poolSize: number;
}

export interface SubmitAnswerResult {
  alreadySubmitted: boolean;
  correct: boolean;
  correctIndexes: number[];
  numericAnswer: number | null;
  explanation: string;
  rewarded: boolean;
  mastery: number;
  strength: TopicMasteryDoc["strength"];
  rewards: OutcomeResult | null;
}

/** Grades one answer server-side, stores the attempt, updates mastery, and pays out on the first correct attempt only. */
export function submitAnswer(input: SubmitAnswerInput): { writes: WriteOp[]; result: SubmitAnswerResult } {
  const { ctx, clock, question, key, answer } = input;
  const uid = ctx.uid;
  const reveal = { correctIndexes: key.correctIndexes, numericAnswer: key.numericAnswer, explanation: key.explanation };
  if (ctx.eventDone) {
    return { writes: [], result: { alreadySubmitted: true, correct: false, ...reveal, rewarded: false, mastery: input.mastery?.mastery ?? 0, strength: input.mastery?.strength ?? "unrated", rewards: null } };
  }
  const correct = gradeAnswer(question.type, key, answer);
  const timeTakenSec = Math.max(0, Math.min(3600, Math.round(input.timeTakenSec)));
  const writes: WriteOp[] = [];
  const attemptDocId = `${uid}_${input.attemptId}`;
  writes.push({
    path: `questionAttempts/${attemptDocId}`,
    data: {
      id: attemptDocId,
      userId: uid,
      questionId: question.id,
      topicId: question.topicId,
      chapterId: question.chapterId,
      subjectId: question.subjectId,
      difficulty: question.difficulty,
      context: input.context,
      assessmentAttemptId: null,
      answer,
      correct,
      timeTakenSec,
      attemptNumber: input.priorAttempts + 1,
      createdAt: clock.stamp
    }
  });
  const previous = input.mastery ?? emptyMastery(uid, question.topicId, question.chapterId, question.subjectId, question.classLevel);
  const mastery = mergeMastery(previous, { questionId: question.id, correct, difficulty: question.difficulty, timeTakenSec, atMs: clock.now.getTime(), context: input.context }, input.poolSize);
  writes.push({ path: `topicMastery/${uid}_${question.topicId}`, data: { ...mastery, lastPracticedAt: clock.stamp } });
  const rewarded = correct && !input.solvedBefore;
  const level = String(question.difficulty) as "1" | "2" | "3";
  const outcome = computeOutcome(ctx, {
    eventId: `answer_${uid}_${input.attemptId}`,
    reason: input.context === "topic" ? "topic_question" : "practice_question",
    refId: question.id,
    xp: rewarded ? ctx.config.questionXpByDifficulty[level] : 0,
    coins: rewarded ? ctx.config.questionCoinsByDifficulty[level] : 0,
    activity: { questions: 1, correct: correct ? 1 : 0, topicIds: [question.topicId] },
    stats: { questionsSolved: rewarded ? 1 : 0 }
  }, clock);
  writes.push(...outcome.writes);
  return { writes, result: { alreadySubmitted: false, correct, ...reveal, rewarded, mastery: mastery.mastery, strength: mastery.strength, rewards: outcome.result } };
}

export interface RecordSessionInput {
  ctx: OutcomeContext;
  clock: Clock;
  sessionId: string;
  topicId: string | null;
  minutes: number;
  kind: SessionKind;
}

export interface RecordSessionResult {
  alreadyRecorded: boolean;
  minutesCounted: number;
  rewards: OutcomeResult | null;
}

/** Records a client timer session with per-call and per-day caps; revision counts toward the streak on its own. */
export function recordSession(input: RecordSessionInput): { writes: WriteOp[]; result: RecordSessionResult } {
  const { ctx, clock } = input;
  const uid = ctx.uid;
  if (ctx.eventDone) return { writes: [], result: { alreadyRecorded: true, minutesCounted: 0, rewards: null } };
  const requested = Math.max(0, Math.min(MAX_SESSION_MINUTES_PER_CALL, Math.round(input.minutes)));
  const minutesCounted = Math.max(0, Math.min(requested, MAX_SESSION_MINUTES_PER_DAY - ctx.activity.minutes));
  const eventId = `session_${uid}_${input.sessionId}`;
  const isRevision = input.kind === "revision";
  const writes: WriteOp[] = [
    { path: `learningSessions/${eventId}`, data: { id: eventId, userId: uid, topicId: input.topicId, kind: input.kind, minutes: minutesCounted, date: clock.today, createdAt: clock.stamp } }
  ];
  const outcome = computeOutcome(ctx, {
    eventId,
    reason: isRevision ? "revision_session" : "study_session",
    refId: input.topicId ?? input.kind,
    xp: isRevision ? ctx.config.revisionXp : minutesCounted * ctx.config.studyMinuteXp,
    coins: 0,
    activity: { minutes: minutesCounted, revisions: isRevision ? 1 : 0, topicIds: input.topicId ? [input.topicId] : [] }
  }, clock);
  writes.push(...outcome.writes);
  return { writes, result: { alreadyRecorded: false, minutesCounted, rewards: outcome.result } };
}
