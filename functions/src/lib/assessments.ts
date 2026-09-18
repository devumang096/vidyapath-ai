// Pure assessment logic: building a question set from a template and grading a finished attempt.
import { computeOutcome, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { gradeAnswer, parseSubmittedAnswer } from "./grading.js";
import { emptyMastery, mergeMastery } from "./mastery.js";
import { LogicError } from "./learning.js";
import type { Clock, WriteOp } from "./writes.js";
import type { AssessmentAttemptDoc, AssessmentDoc, AssessmentKind, Difficulty, QuestionDoc, QuestionKeyDoc, Strength, SubmittedAnswer, TopicMasteryDoc } from "../types.js";

/** Fewer than this many questions in the pool and the assessment cannot start honestly. */
export const MIN_QUESTIONS = 5;
export const PERIODIC_KINDS: readonly AssessmentKind[] = ["daily", "weekly", "monthly"];

/** Period key so daily, weekly and monthly assessments happen once per period per student. */
export function periodKeyFor(kind: AssessmentKind, today: string): string | null {
  if (kind === "daily") return today;
  if (kind === "monthly") return today.slice(0, 7);
  if (kind === "weekly") {
    const date = new Date(`${today}T00:00:00Z`);
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return null;
}

function seededShuffle<T>(items: T[], seedText: string): T[] {
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0;
    const swap = seed % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Picks question ids for a template from the candidate pool. Each difficulty bucket is filled from
 * the template counts; shortfalls are borrowed from the other buckets so a small pool still yields a
 * usable paper. Deterministic for a given seed (uid + period) so a periodic paper is the same on retry.
 */
export function pickQuestions(template: AssessmentDoc, pool: QuestionDoc[], seed: string): string[] {
  if (pool.length < MIN_QUESTIONS) throw new LogicError("failed-precondition", `Not enough questions yet: this assessment needs at least ${MIN_QUESTIONS} and ${pool.length} exist for your selection.`);
  const shuffled = seededShuffle(pool, seed);
  const buckets: Record<Difficulty, QuestionDoc[]> = { 1: [], 2: [], 3: [] };
  for (const question of shuffled) buckets[question.difficulty].push(question);
  const wanted = Object.values(template.questionCounts).reduce((sum, count) => sum + count, 0);
  const picked: QuestionDoc[] = [];
  for (const level of [1, 2, 3] as Difficulty[]) picked.push(...buckets[level].splice(0, template.questionCounts[String(level) as "1" | "2" | "3"]));
  const leftovers = seededShuffle([...buckets[1], ...buckets[2], ...buckets[3]], `${seed}-fill`);
  while (picked.length < wanted && leftovers.length) picked.push(leftovers.shift() as QuestionDoc);
  return picked.map((question) => question.id);
}

export interface StartInput {
  uid: string;
  template: AssessmentDoc;
  scopeId: string | null;
  pool: QuestionDoc[];
  existing: AssessmentAttemptDoc | null;
  attemptId: string;
  clock: Clock;
}

export interface StartResult {
  attemptId: string;
  questionIds: string[];
  timeLimitSec: number;
  resumed: boolean;
  finalized: boolean;
}

export function startAttempt(input: StartInput): { writes: WriteOp[]; result: StartResult } {
  const { template, existing, clock } = input;
  if (existing) {
    return { writes: [], result: { attemptId: existing.id, questionIds: existing.questionIds, timeLimitSec: template.timeLimitSec, resumed: !existing.finalized, finalized: existing.finalized } };
  }
  const periodKey = periodKeyFor(template.kind, clock.today);
  const questionIds = pickQuestions(template, input.pool, `${input.uid}-${template.id}-${periodKey ?? input.attemptId}`);
  const attempt: AssessmentAttemptDoc = {
    id: input.attemptId,
    userId: input.uid,
    assessmentId: template.id,
    kind: template.kind,
    periodKey,
    scopeId: input.scopeId,
    questionIds,
    answers: {},
    finalized: false,
    score: null,
    total: null,
    timeTakenSec: null,
    timeLimitSec: template.timeLimitSec,
    results: null,
    topicSummary: null,
    createdAt: clock.stamp,
    finalizedAt: null
  };
  return { writes: [{ path: `assessmentAttempts/${attempt.id}`, data: attempt as unknown as Record<string, unknown> }], result: { attemptId: attempt.id, questionIds, timeLimitSec: template.timeLimitSec, resumed: false, finalized: false } };
}

export interface SubmitInput {
  ctx: OutcomeContext;
  clock: Clock;
  attempt: AssessmentAttemptDoc;
  questions: QuestionDoc[];
  keys: QuestionKeyDoc[];
  rawAnswers: Record<string, unknown>;
  timeTakenSec: number;
  mastery: Map<string, TopicMasteryDoc | null>;
  poolSizes: Map<string, number>;
}

export interface TopicOutcome {
  topicId: string;
  attempts: number;
  correct: number;
  accuracy: number;
  strength: Strength;
}

export interface SubmitResult {
  alreadyFinalized: boolean;
  score: number;
  total: number;
  accuracy: number;
  timeTakenSec: number;
  results: NonNullable<AssessmentAttemptDoc["results"]>;
  topics: TopicOutcome[];
  strongTopics: string[];
  weakTopics: string[];
  recommendedRevision: string[];
  recommendedPractice: string[];
  rewards: OutcomeResult | null;
}

/**
 * Grades every question in the attempt against the private keys, stores per-question attempts,
 * updates mastery per topic, and pays XP per question plus coins per correct answer once.
 * Unanswered questions count as wrong. Never grades an attempt that belongs to someone else or is final.
 */
export function submitAttempt(input: SubmitInput): { writes: WriteOp[]; result: SubmitResult } {
  const { ctx, clock, attempt } = input;
  if (attempt.userId !== ctx.uid) throw new LogicError("permission-denied", "Not your assessment.");
  if (attempt.finalized || ctx.eventDone) {
    return { writes: [], result: summarise(attempt, null, true) };
  }
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const keyById = new Map(input.keys.map((key) => [key.id, key]));
  const results: NonNullable<AssessmentAttemptDoc["results"]> = {};
  const answers: Record<string, SubmittedAnswer> = {};
  const topicSummary: Record<string, { attempts: number; correct: number }> = {};
  const writes: WriteOp[] = [];
  const timeTakenSec = Math.max(0, Math.min(attempt.timeLimitSec * 2, Math.round(input.timeTakenSec)));
  const perQuestionSec = Math.round(timeTakenSec / Math.max(1, attempt.questionIds.length));
  const masteryState = new Map(input.mastery);
  let score = 0;
  attempt.questionIds.forEach((questionId, index) => {
    const question = questionById.get(questionId);
    const key = keyById.get(questionId);
    if (!question || !key) throw new LogicError("failed-precondition", "A question in this assessment is missing.");
    const answer = parseSubmittedAnswer(input.rawAnswers[questionId], question.type, question.options.length);
    const correct = answer ? gradeAnswer(question.type, key, answer) : false;
    if (answer) answers[questionId] = answer;
    if (correct) score += 1;
    results[questionId] = { correctIndexes: key.correctIndexes, numericAnswer: key.numericAnswer, explanation: key.explanation, correct };
    const summary = topicSummary[question.topicId] ?? { attempts: 0, correct: 0 };
    summary.attempts += 1;
    if (correct) summary.correct += 1;
    topicSummary[question.topicId] = summary;
    writes.push({
      path: `questionAttempts/${ctx.uid}_${attempt.id}_${index}`,
      data: {
        id: `${ctx.uid}_${attempt.id}_${index}`, userId: ctx.uid, questionId, topicId: question.topicId, chapterId: question.chapterId, subjectId: question.subjectId, difficulty: question.difficulty,
        context: "assessment", assessmentAttemptId: attempt.id, answer: answer ?? { indexes: [] }, correct, timeTakenSec: perQuestionSec, attemptNumber: 1, createdAt: clock.stamp
      }
    });
    const previous = masteryState.get(question.topicId) ?? emptyMastery(ctx.uid, question.topicId, question.chapterId, question.subjectId, question.classLevel);
    masteryState.set(question.topicId, mergeMastery(previous, { questionId, correct, difficulty: question.difficulty, timeTakenSec: perQuestionSec, atMs: clock.now.getTime(), context: "assessment" }, input.poolSizes.get(question.topicId) ?? 1));
  });
  for (const [topicId, doc] of masteryState) if (doc) writes.push({ path: `topicMastery/${ctx.uid}_${topicId}`, data: { ...doc, lastPracticedAt: clock.stamp } });
  const total = attempt.questionIds.length;
  const finalized: AssessmentAttemptDoc = { ...attempt, answers, finalized: true, score, total, timeTakenSec, results, topicSummary, finalizedAt: clock.stamp };
  writes.push({ path: `assessmentAttempts/${attempt.id}`, data: finalized as unknown as Record<string, unknown> });
  const outcome = computeOutcome(ctx, {
    eventId: `assessment_${attempt.id}`,
    reason: `assessment_${attempt.kind}`,
    refId: attempt.id,
    xp: total * ctx.config.assessmentXpPerQuestion,
    coins: score * ctx.config.assessmentCoinsPerCorrect,
    activity: { assessments: 1, questions: total, correct: score, topicIds: Object.keys(topicSummary) },
    stats: { assessmentsCompleted: 1 }
  }, clock);
  writes.push(...outcome.writes);
  return { writes, result: summarise(finalized, outcome.result, false, masteryState) };
}

function summarise(attempt: AssessmentAttemptDoc, rewards: OutcomeResult | null, alreadyFinalized: boolean, masteryState?: Map<string, TopicMasteryDoc | null>): SubmitResult {
  const topics: TopicOutcome[] = Object.entries(attempt.topicSummary ?? {}).map(([topicId, summary]) => ({
    topicId,
    attempts: summary.attempts,
    correct: summary.correct,
    accuracy: Math.round((summary.correct / summary.attempts) * 100),
    strength: masteryState?.get(topicId)?.strength ?? "unrated"
  })).sort((left, right) => left.accuracy - right.accuracy);
  const total = attempt.total ?? attempt.questionIds.length;
  const score = attempt.score ?? 0;
  return {
    alreadyFinalized,
    score,
    total,
    accuracy: total ? Math.round((score / total) * 100) : 0,
    timeTakenSec: attempt.timeTakenSec ?? 0,
    results: attempt.results ?? {},
    topics,
    strongTopics: topics.filter((topic) => topic.accuracy >= 75).map((topic) => topic.topicId),
    weakTopics: topics.filter((topic) => topic.accuracy < 50).map((topic) => topic.topicId),
    recommendedRevision: topics.filter((topic) => topic.accuracy < 50).map((topic) => topic.topicId),
    recommendedPractice: topics.filter((topic) => topic.accuracy >= 50 && topic.accuracy < 75).map((topic) => topic.topicId),
    rewards
  };
}
