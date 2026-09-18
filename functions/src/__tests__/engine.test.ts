import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/admin.js", () => ({ db: {} }));

import { computeOutcome, type OutcomeContext } from "../lib/outcome.js";
import { completeLesson, recordSession, submitAnswer } from "../lib/learning.js";
import { claimProgram, programProgress, redeem, spin } from "../lib/rewards.js";
import { DEFAULT_NOTIFICATION_PREFS, type LessonDoc, type QuestionDoc, type QuestionKeyDoc, type RewardConfig, type RewardDoc } from "../types.js";
import type { Clock, WriteOp } from "../lib/writes.js";

const config: RewardConfig = {
  lessonXp: 50,
  questionXpByDifficulty: { "1": 10, "2": 20, "3": 35 },
  questionCoinsByDifficulty: { "1": 1, "2": 2, "3": 4 },
  assessmentXpPerQuestion: 10,
  assessmentCoinsPerCorrect: 1,
  chapterCompleteXp: 200,
  chapterCompleteCoins: 25,
  challengeXp: 150,
  challengeCoins: 20,
  revisionXp: 25,
  studyMinuteXp: 1,
  streakDayMinutes: 20,
  streakDayQuestions: 10,
  spinCooldownHours: 24,
  spinOutcomes: [{ label: "+10 Orbit Coins", weight: 1, xp: 0, coins: 10, streakProtection: 0, badgeId: null }, { label: "Streak Protection", weight: 1, xp: 0, coins: 0, streakProtection: 1, badgeId: null }],
  aiDailyLimit: 40,
  streakMilestones: [1, 7, 30, 50, 90, 100],
  goodieCriteria: { chapters: 20, questions: 2000, streak: 30 },
  ninetyDayCriteria: { activeDays: 90, streak: 90, studyHours: 100, questions: 1500, chapters: 15 }
};

let ids = 0;
const clock: Clock = { now: new Date("2026-09-18T05:00:00Z"), today: "2026-09-18", stamp: "STAMP", newId: () => `n${(ids += 1)}` };

function context(overrides: Partial<OutcomeContext> = {}): OutcomeContext {
  return {
    uid: "u1",
    config,
    user: {
      uid: "u1", email: "", name: "", classLevel: 10, goal: "school", subjects: ["physics"], language: "en", learningLevel: "beginner", dailyGoalMinutes: 60,
      school: null, phone: null, photoURL: null, onboardingComplete: true, notificationPrefs: DEFAULT_NOTIFICATION_PREFS, role: "student",
      xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0, totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: null, updatedAt: null
    },
    streak: { current: 3, longest: 3, lastQualifiedDate: "2026-09-17", protectionTokens: 0, milestonesAwarded: [1] },
    activity: { minutes: 0, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: false },
    eventDone: false,
    ...overrides
  };
}

const at = (writes: WriteOp[], path: string) => writes.find((write) => write.path === path && !("delete" in write)) as { path: string; data: Record<string, unknown> } | undefined;

describe("computeOutcome", () => {
  it("writes ledger entries, absolute balances, activity and advances the streak on a qualifying action", () => {
    const { writes, result } = computeOutcome(context(), { eventId: "e1", reason: "lesson_completed", refId: "l1", xp: 50, coins: 0, activity: { lessons: 1, topicIds: ["t1"] }, stats: { lessonsCompleted: 1 } }, clock);
    expect(result.streak).toMatchObject({ current: 4, incremented: true, qualifiedToday: true });
    expect(result.badges).toEqual(["first_step"]);
    expect(at(writes, "xpTransactions/e1")?.data.amount).toBe(50);
    expect(at(writes, "coinTransactions/e1")).toBeUndefined();
    expect(at(writes, "users/u1")?.data).toMatchObject({ xp: 50, lessonsCompleted: 1, activeDays: 1, badgeIds: ["first_step"] });
    expect(at(writes, "dailyActivity/u1_2026-09-18")?.data).toMatchObject({ lessons: 1, xp: 50, topicIds: ["t1"], qualified: true });
    expect(at(writes, "userBadges/u1/badges/first_step")).toBeDefined();
  });
  it("does not advance the streak or active days twice on the same day", () => {
    const ctx = context({ activity: { minutes: 25, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: true }, streak: { current: 4, longest: 4, lastQualifiedDate: "2026-09-18", protectionTokens: 0, milestonesAwarded: [1] } });
    const { writes, result } = computeOutcome(ctx, { eventId: "e2", reason: "study_session", refId: "t", xp: 5, coins: 0, activity: { minutes: 5 } }, clock);
    expect(result.streak).toMatchObject({ current: 4, incremented: false });
    expect(at(writes, "users/u1")?.data.activeDays).toBe(0);
  });
  it("records negative coin ledger entries and never lets a balance come from the client", () => {
    const { writes } = computeOutcome(context({ user: { ...context().user, coins: 100 } }), { eventId: "c1", reason: "reward_redemption", refId: "r1", xp: 0, coins: -60 }, clock);
    expect(at(writes, "coinTransactions/c1")?.data.amount).toBe(-60);
    expect(at(writes, "users/u1")?.data.coins).toBe(40);
  });
  it("adds streak protection tokens from a spin", () => {
    const { writes } = computeOutcome(context(), { eventId: "s1", reason: "orbit_spin", refId: "s1", xp: 0, coins: 0, streakProtection: 1 }, clock);
    expect(at(writes, "streaks/u1")?.data.protectionTokens).toBe(1);
  });
  it("skips notifications the student has turned off", () => {
    const ctx = context({ user: { ...context().user, notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, reward: false } } });
    const { writes } = computeOutcome(ctx, { eventId: "e1", reason: "lesson_completed", refId: "l1", xp: 50, coins: 0, activity: { lessons: 1 }, stats: { lessonsCompleted: 1 } }, clock);
    expect(writes.some((write) => write.path.startsWith("notifications/"))).toBe(false);
  });
});

const lesson: LessonDoc = { id: "l1", topicId: "t1", chapterId: "c1", subjectId: "physics", classLevel: 9, title: "", description: "", estimatedMinutes: 10, order: 1, blocks: [] };
const question: QuestionDoc = { id: "q1", topicId: "t1", chapterId: "c1", subjectId: "physics", classLevel: 9, type: "mcq", difficulty: 2, examTags: ["school"], pyq: false, text: "", options: ["a", "b", "c", "d"], unit: null, hints: [], source: null };
const key: QuestionKeyDoc = { id: "q1", correctIndexes: [2], numericAnswer: null, tolerance: 0, explanation: "because" };

describe("learning logic", () => {
  it("completes a lesson once and pays the chapter bonus when the last lesson finishes", () => {
    const first = completeLesson({ ctx: context(), clock, lesson, progress: null, chapterProgress: { id: "", userId: "u1", chapterId: "c1", subjectId: "physics", classLevel: 9, lessonsTotal: 2, lessonsCompleted: 1, completed: false, completedAt: null }, lessonsInChapter: 2 });
    expect(first.result).toMatchObject({ alreadyCompleted: false, chapterCompleted: true });
    expect(at(first.writes, "users/u1")?.data).toMatchObject({ xp: 250, coins: 25, chaptersCompleted: 1 });
    const again = completeLesson({ ctx: context({ eventDone: true }), clock, lesson, progress: null, chapterProgress: null, lessonsInChapter: 2 });
    expect(again.result.alreadyCompleted).toBe(true);
    expect(again.writes).toHaveLength(0);
  });
  it("grades server-side, stores the attempt and pays only the first correct attempt", () => {
    const base = { ctx: context(), clock, attemptId: "a1", question, key, timeTakenSec: 12, context: "practice" as const, mastery: null, priorAttempts: 0, solvedBefore: false, poolSize: 10 };
    const wrong = submitAnswer({ ...base, answer: { indexes: [0] } });
    expect(wrong.result).toMatchObject({ correct: false, rewarded: false, correctIndexes: [2], explanation: "because" });
    expect(at(wrong.writes, "questionAttempts/u1_a1")?.data).toMatchObject({ correct: false, attemptNumber: 1 });
    expect(at(wrong.writes, "users/u1")?.data).toMatchObject({ xp: 0, questionsSolved: 0 });
    const right = submitAnswer({ ...base, attemptId: "a2", answer: { indexes: [2] }, priorAttempts: 1 });
    expect(right.result).toMatchObject({ correct: true, rewarded: true });
    expect(at(right.writes, "users/u1")?.data).toMatchObject({ xp: 20, coins: 2, questionsSolved: 1 });
    const repeat = submitAnswer({ ...base, attemptId: "a3", answer: { indexes: [2] }, priorAttempts: 2, solvedBefore: true });
    expect(repeat.result).toMatchObject({ correct: true, rewarded: false });
    expect(at(repeat.writes, "topicMastery/u1_t1")).toBeDefined();
  });
  it("caps study minutes per call and per day", () => {
    const capped = recordSession({ ctx: context({ activity: { ...context().activity, minutes: 590 } }), clock, sessionId: "s1", topicId: "t1", minutes: 45, kind: "learning" });
    expect(capped.result.minutesCounted).toBe(10);
    expect(at(capped.writes, "users/u1")?.data.totalStudyMinutes).toBe(10);
    const revision = recordSession({ ctx: context(), clock, sessionId: "s2", topicId: null, minutes: 5, kind: "revision" });
    expect(at(revision.writes, "xpTransactions/session_u1_s2")?.data.amount).toBe(25);
    expect(revision.result.rewards?.streak.qualifiedToday).toBe(true);
  });
});

const reward: RewardDoc = { id: "r1", name: "Notebook", description: "", icon: "", coinPrice: 80, stock: 1, available: true, oncePerUser: false, eligibility: { minStreak: 0, minChaptersCompleted: 0, minQuestionsSolved: 0 }, kind: "physical", order: 1 };

describe("rewards logic", () => {
  it("refuses redemption without deducting when coins, stock or eligibility fail", () => {
    const base = { clock, reward, redemptionKey: "k1", existing: null, redeemedBefore: false, streakCurrent: 3 };
    expect(() => redeem({ ...base, ctx: context() })).toThrow(/more Orbit Coins/);
    expect(() => redeem({ ...base, ctx: context({ user: { ...context().user, coins: 100 } }), reward: { ...reward, stock: 0 } })).toThrow(/out of stock/);
    expect(() => redeem({ ...base, ctx: context({ user: { ...context().user, coins: 100 } }), reward: { ...reward, eligibility: { ...reward.eligibility, minStreak: 7 } } })).toThrow(/7-day streak/);
  });
  it("deducts coins, reduces stock and creates the redemption atomically", () => {
    const { writes, result } = redeem({ ctx: context({ user: { ...context().user, coins: 100 } }), clock, reward, redemptionKey: "k1", existing: null, redeemedBefore: false, streakCurrent: 3 });
    expect(result).toMatchObject({ alreadyRedeemed: false, coinsSpent: 80, remainingCoins: 20 });
    expect(at(writes, "rewards/r1")?.data.stock).toBe(0);
    expect(at(writes, "redemptions/u1_k1")?.data).toMatchObject({ status: "pending", coinsSpent: 80 });
    expect(at(writes, "users/u1")?.data.coins).toBe(20);
  });
  it("spins only once per cooldown and rejects replayed counters", () => {
    const ok = spin({ ctx: context(), clock, state: null, expectedSpins: 0, nextSpinAtMs: null, random: 0.9 });
    expect(ok.result.streakProtection).toBe(1);
    expect(at(ok.writes, "streaks/u1")?.data.protectionTokens).toBe(1);
    expect(() => spin({ ctx: context(), clock, state: null, expectedSpins: 0, nextSpinAtMs: clock.now.getTime() + 1000, random: 0.1 })).toThrow(/cooldown/);
    expect(() => spin({ ctx: context(), clock, state: { uid: "u1", nextSpinAt: null, lastResult: null, totalSpins: 2 }, expectedSpins: 1, nextSpinAtMs: null, random: 0.1 })).toThrow(/already in progress/);
  });
});

describe("program rewards", () => {
  it("refuses until every criterion is met, then records one claim per program without touching coins", () => {
    const met = context({ user: { ...context().user, chaptersCompleted: 20, questionsSolved: 2000 } });
    expect(programProgress("goodie", met.user, 30, config.goodieCriteria).every((row) => row.value >= row.target)).toBe(true);
    expect(() => claimProgram({ ctx: met, clock, program: "goodie", existing: null, streakCurrent: 5 })).toThrow(/Current streak 5\/30/);
    const { writes, result } = claimProgram({ ctx: met, clock, program: "goodie", existing: null, streakCurrent: 30 });
    expect(result).toEqual({ alreadyClaimed: false, redemptionId: "u1_program_goodie" });
    expect(at(writes, "redemptions/u1_program_goodie")?.data).toMatchObject({ type: "goodie", coinsSpent: 0, status: "pending" });
    expect(writes.some((write) => write.path.startsWith("coinTransactions/"))).toBe(false);
    const again = claimProgram({ ctx: met, clock, program: "goodie", existing: at(writes, "redemptions/u1_program_goodie")?.data as never, streakCurrent: 30 });
    expect(again.result.alreadyClaimed).toBe(true);
    expect(again.writes).toHaveLength(0);
    expect(() => claimProgram({ ctx: context(), clock, program: "ninety_day", existing: null, streakCurrent: 90 })).toThrow(/Active days 0\/90/);
  });
});
