import { describe, expect, it } from "vitest";
import { periodKeyFor, pickQuestions, startAttempt, submitAttempt } from "../lib/assessments.js";
import type { OutcomeContext } from "../lib/outcome.js";
import type { Clock, WriteOp } from "../lib/writes.js";
import { DEFAULT_NOTIFICATION_PREFS, type AssessmentDoc, type QuestionDoc, type QuestionKeyDoc, type RewardConfig } from "../types.js";

const config = { assessmentXpPerQuestion: 10, assessmentCoinsPerCorrect: 1, streakDayMinutes: 20, streakDayQuestions: 10, streakMilestones: [1, 7], lessonXp: 50, questionXpByDifficulty: { "1": 10, "2": 20, "3": 35 }, questionCoinsByDifficulty: { "1": 1, "2": 2, "3": 4 }, chapterCompleteXp: 200, chapterCompleteCoins: 25, challengeXp: 0, challengeCoins: 0, revisionXp: 25, studyMinuteXp: 1, spinCooldownHours: 24, spinOutcomes: [], aiDailyLimit: 40, goodieCriteria: { chapters: 1, questions: 1, streak: 1 }, ninetyDayCriteria: { activeDays: 1, streak: 1, studyHours: 1, questions: 1, chapters: 1 } } as RewardConfig;
const clock: Clock = { now: new Date("2026-09-19T05:00:00Z"), today: "2026-09-19", stamp: "STAMP", newId: () => "n" };
const template: AssessmentDoc = { id: "daily", kind: "daily", title: "Daily", description: "", questionCounts: { "1": 3, "2": 2, "3": 1 }, timeLimitSec: 600, examTag: null, subjectIds: [], order: 1 };

function question(id: string, difficulty: 1 | 2 | 3, topicId = "t1"): QuestionDoc {
  return { id, topicId, chapterId: "c1", subjectId: "physics", classLevel: 9, type: "mcq", difficulty, examTags: ["school"], pyq: false, text: id, options: ["a", "b", "c", "d"], unit: null, hints: [], source: null };
}
const pool = [question("q1", 1), question("q2", 1), question("q3", 1), question("q4", 1), question("q5", 2), question("q6", 2), question("q7", 3, "t2")];
const keys: QuestionKeyDoc[] = pool.map((item) => ({ id: item.id, correctIndexes: [1], numericAnswer: null, tolerance: 0, explanation: `why ${item.id}` }));

function ctx(overrides: Partial<OutcomeContext> = {}): OutcomeContext {
  return {
    uid: "u1", config,
    user: { uid: "u1", email: "", name: "", classLevel: 9, goal: "school", subjects: ["physics"], language: "en", learningLevel: "beginner", dailyGoalMinutes: 60, school: null, phone: null, photoURL: null, onboardingComplete: true, notificationPrefs: DEFAULT_NOTIFICATION_PREFS, role: "student", xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0, totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: null, updatedAt: null },
    streak: { current: 0, longest: 0, lastQualifiedDate: null, protectionTokens: 0, milestonesAwarded: [] },
    activity: { minutes: 0, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: false },
    eventDone: false, ...overrides
  };
}
const at = (writes: WriteOp[], path: string) => (writes.find((write) => write.path === path) as { data: Record<string, unknown> } | undefined)?.data;

describe("assessment periods and picking", () => {
  it("keys daily, weekly and monthly periods", () => {
    expect(periodKeyFor("daily", "2026-09-19")).toBe("2026-09-19");
    expect(periodKeyFor("monthly", "2026-09-19")).toBe("2026-09");
    expect(periodKeyFor("weekly", "2026-09-19")).toBe("2026-W38");
    expect(periodKeyFor("weekly", "2026-09-21")).toBe("2026-W39");
    expect(periodKeyFor("topic_test", "2026-09-19")).toBeNull();
  });
  it("fills difficulty buckets, borrows on shortfall, is deterministic, and refuses tiny pools", () => {
    const ids = pickQuestions(template, pool, "seed");
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain("q7");
    expect(pickQuestions(template, pool, "seed")).toEqual(ids);
    expect(pickQuestions(template, pool, "other")).not.toEqual(ids);
    expect(() => pickQuestions(template, pool.slice(0, 4), "seed")).toThrow(/Not enough questions/);
  });
  it("resumes an existing periodic attempt instead of building a new paper", () => {
    const first = startAttempt({ uid: "u1", template, scopeId: null, pool, existing: null, attemptId: "u1_daily_2026-09-19", clock });
    expect(first.result.resumed).toBe(false);
    expect(first.writes).toHaveLength(1);
    const existing = at(first.writes, "assessmentAttempts/u1_daily_2026-09-19") as never;
    const again = startAttempt({ uid: "u1", template, scopeId: null, pool: [], existing, attemptId: "u1_daily_2026-09-19", clock });
    expect(again.result).toMatchObject({ resumed: true, finalized: false, questionIds: first.result.questionIds });
    expect(again.writes).toHaveLength(0);
  });
});

describe("assessment grading", () => {
  const started = startAttempt({ uid: "u1", template, scopeId: null, pool, existing: null, attemptId: "a1", clock });
  const attempt = at(started.writes, "assessmentAttempts/a1") as never as Parameters<typeof submitAttempt>[0]["attempt"];
  it("grades every question, treats missing answers as wrong, updates mastery and pays once", () => {
    const [first, second] = attempt.questionIds;
    const rawAnswers = { [first]: { indexes: [1] }, [second]: { indexes: [0] } };
    const { writes, result } = submitAttempt({ ctx: ctx(), clock, attempt, questions: pool, keys, rawAnswers, timeTakenSec: 300, mastery: new Map(), poolSizes: new Map([["t1", 6], ["t2", 1]]) });
    expect(result).toMatchObject({ alreadyFinalized: false, score: 1, total: 6, accuracy: 17 });
    expect(result.results[first].correct).toBe(true);
    expect(result.results[second]).toMatchObject({ correct: false, explanation: `why ${second}` });
    expect(result.weakTopics.length).toBeGreaterThan(0);
    expect(at(writes, "assessmentAttempts/a1")).toMatchObject({ finalized: true, score: 1 });
    expect(writes.filter((write) => write.path.startsWith("questionAttempts/"))).toHaveLength(6);
    expect(at(writes, "topicMastery/u1_t1")).toMatchObject({ assessmentAttempts: 5 });
    expect(at(writes, "users/u1")).toMatchObject({ xp: 60, coins: 1, assessmentsCompleted: 1 });
    expect(result.rewards?.streak.qualifiedToday).toBe(true);
  });
  it("refuses another student's attempt and returns the stored result when already final", () => {
    expect(() => submitAttempt({ ctx: ctx({ uid: "u2", user: { ...ctx().user, uid: "u2" } }), clock, attempt, questions: pool, keys, rawAnswers: {}, timeTakenSec: 1, mastery: new Map(), poolSizes: new Map() })).toThrow(/Not your assessment/);
    const finalized = { ...attempt, finalized: true, score: 2, total: 6, topicSummary: { t1: { attempts: 5, correct: 2 } }, results: {} };
    const { writes, result } = submitAttempt({ ctx: ctx(), clock, attempt: finalized, questions: pool, keys, rawAnswers: {}, timeTakenSec: 1, mastery: new Map(), poolSizes: new Map() });
    expect(writes).toHaveLength(0);
    expect(result).toMatchObject({ alreadyFinalized: true, score: 2, accuracy: 33 });
  });
});
