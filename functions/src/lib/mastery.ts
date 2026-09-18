import type { ClassLevel, Difficulty, Strength, SubjectId, TopicMasteryDoc } from "../types.js";

/**
 * Topic mastery, 0 to 100. Only graded attempts move it; opening content never does.
 *
 *   mastery = clamp(0, 100,
 *       0.55 * weightedAccuracy      difficulty-weighted accuracy (weights 1 / 1.5 / 2) over the last 30 attempts
 *     + 0.25 * assessmentAccuracy    accuracy on this topic inside assessments (falls back to weightedAccuracy if none)
 *     + 10   * coverage              distinct questions attempted / min(20, questions available in the topic), 0..1
 *     + 10   * recency               1 when practised in the last 7 days, linear decay to 0 at 45 days
 *     - 20   * repeatedMistakes      fraction of the last 10 attempts answered wrong, capped at 0.5
 *   )
 *
 * Strength labels: fewer than 3 attempts -> unrated; >= 75 strong; 55..74 good; 35..54 needs_practice; < 35 weak.
 * Change the constants here and every dashboard, topic page and recommendation follows.
 */
const RECENT_WINDOW = 30;
const MISTAKE_WINDOW = 10;
const COVERAGE_CAP = 20;
const RECENCY_FULL_DAYS = 7;
const RECENCY_ZERO_DAYS = 45;
const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { 1: 1, 2: 1.5, 3: 2 };
const MIN_ATTEMPTS_FOR_RATING = 3;

export interface MasteryEvent {
  questionId: string;
  correct: boolean;
  difficulty: Difficulty;
  timeTakenSec: number;
  atMs: number;
  context: "practice" | "topic" | "assessment";
}

export function emptyMastery(userId: string, topicId: string, chapterId: string, subjectId: SubjectId, classLevel: ClassLevel): TopicMasteryDoc {
  return {
    id: `${userId}_${topicId}`,
    userId,
    topicId,
    chapterId,
    subjectId,
    classLevel,
    attempts: 0,
    correct: 0,
    accuracy: 0,
    distinctQuestionIds: [],
    recent: [],
    assessmentAttempts: 0,
    assessmentCorrect: 0,
    timeSpentSec: 0,
    mastery: 0,
    strength: "unrated",
    lastPracticedAt: null
  };
}

export function classify(mastery: number, attempts: number): Strength {
  if (attempts < MIN_ATTEMPTS_FOR_RATING) return "unrated";
  if (mastery >= 75) return "strong";
  if (mastery >= 55) return "good";
  if (mastery >= 35) return "needs_practice";
  return "weak";
}

function weightedAccuracy(recent: TopicMasteryDoc["recent"]): number {
  if (recent.length === 0) return 0;
  let weightSum = 0;
  let correctSum = 0;
  for (const item of recent) {
    const weight = DIFFICULTY_WEIGHT[item.difficulty];
    weightSum += weight;
    if (item.correct) correctSum += weight;
  }
  return (correctSum / weightSum) * 100;
}

function recencyScore(lastMs: number | null, nowMs: number): number {
  if (lastMs === null) return 0;
  const days = (nowMs - lastMs) / 86_400_000;
  if (days <= RECENCY_FULL_DAYS) return 1;
  if (days >= RECENCY_ZERO_DAYS) return 0;
  return 1 - (days - RECENCY_FULL_DAYS) / (RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS);
}

/** Recompute the score from stored components. Exported so the frontend can show what the number means. */
export function computeMastery(doc: Pick<TopicMasteryDoc, "recent" | "assessmentAttempts" | "assessmentCorrect" | "distinctQuestionIds">, poolSize: number, nowMs: number, lastMs: number | null): number {
  const weighted = weightedAccuracy(doc.recent);
  const assessment = doc.assessmentAttempts > 0 ? (doc.assessmentCorrect / doc.assessmentAttempts) * 100 : weighted;
  const coverage = Math.min(1, doc.distinctQuestionIds.length / Math.max(1, Math.min(COVERAGE_CAP, poolSize)));
  const recency = recencyScore(lastMs, nowMs);
  const lastTen = doc.recent.slice(-MISTAKE_WINDOW);
  const mistakes = lastTen.length ? Math.min(0.5, lastTen.filter((item) => !item.correct).length / lastTen.length) : 0;
  const raw = 0.55 * weighted + 0.25 * assessment + 10 * coverage + 10 * recency - 20 * mistakes;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

/** Pure merge of one graded attempt into a topic's mastery doc. */
export function mergeMastery(prev: TopicMasteryDoc, event: MasteryEvent, poolSize: number): TopicMasteryDoc {
  const recent = [...prev.recent, { correct: event.correct, difficulty: event.difficulty, at: event.atMs }].slice(-RECENT_WINDOW);
  const distinctQuestionIds = prev.distinctQuestionIds.includes(event.questionId) ? prev.distinctQuestionIds : [...prev.distinctQuestionIds, event.questionId];
  const attempts = prev.attempts + 1;
  const correct = prev.correct + (event.correct ? 1 : 0);
  const isAssessment = event.context === "assessment";
  const next: TopicMasteryDoc = {
    ...prev,
    attempts,
    correct,
    accuracy: Math.round((correct / attempts) * 100),
    distinctQuestionIds,
    recent,
    assessmentAttempts: prev.assessmentAttempts + (isAssessment ? 1 : 0),
    assessmentCorrect: prev.assessmentCorrect + (isAssessment && event.correct ? 1 : 0),
    timeSpentSec: prev.timeSpentSec + Math.max(0, event.timeTakenSec),
    mastery: 0,
    strength: "unrated",
    lastPracticedAt: prev.lastPracticedAt
  };
  next.mastery = computeMastery(next, poolSize, event.atMs, event.atMs);
  next.strength = classify(next.mastery, attempts);
  return next;
}
