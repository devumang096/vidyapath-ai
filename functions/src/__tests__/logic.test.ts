import { describe, expect, it } from "vitest";
import { daysBetween, istDate } from "../lib/time.js";
import { activityQualifies, advanceStreak, effectiveStreak, newMilestones } from "../lib/streak.js";
import { canSpin, pickOutcome } from "../lib/spin.js";
import { leaksFinalAnswer, needsSupportNotice, validateAiText } from "../lib/aiValidate.js";
import { fallbackResponse, planMinutes } from "../lib/aiFallback.js";
import { badgesToAward } from "../lib/badges.js";
import { classify, computeMastery, emptyMastery, mergeMastery } from "../lib/mastery.js";
import { gradeAnswer, parseSubmittedAnswer } from "../lib/grading.js";
import { anonUsername, inviteCode } from "../lib/hash.js";
import type { QuestionKeyDoc, TopicDoc } from "../types.js";

const thresholds = { streakDayMinutes: 20, streakDayQuestions: 10 };
const noActivity = { minutes: 0, questions: 0, lessons: 0, assessments: 0, revisions: 0 };

describe("time", () => {
  it("uses the IST calendar date, not UTC", () => {
    expect(istDate(new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-02");
    expect(istDate(new Date("2026-01-01T18:00:00Z"))).toBe("2026-01-01");
  });
  it("counts whole days", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });
});

describe("streak", () => {
  it("does not qualify on login alone", () => {
    expect(activityQualifies(noActivity, thresholds)).toBe(false);
  });
  it("qualifies on any one meaningful threshold", () => {
    expect(activityQualifies({ ...noActivity, minutes: 20 }, thresholds)).toBe(true);
    expect(activityQualifies({ ...noActivity, questions: 10 }, thresholds)).toBe(true);
    expect(activityQualifies({ ...noActivity, lessons: 1 }, thresholds)).toBe(true);
    expect(activityQualifies({ ...noActivity, assessments: 1 }, thresholds)).toBe(true);
    expect(activityQualifies({ ...noActivity, minutes: 19, questions: 9 }, thresholds)).toBe(false);
  });
  it("increments on consecutive days and resets after a gap", () => {
    const base = { current: 3, longest: 5, lastQualifiedDate: "2026-09-17", protectionTokens: 0 };
    expect(advanceStreak(base, "2026-09-18")).toMatchObject({ current: 4, longest: 5, incremented: true, protectionUsed: false });
    expect(advanceStreak(base, "2026-09-20")).toMatchObject({ current: 1, longest: 5 });
    expect(advanceStreak(base, "2026-09-17")).toMatchObject({ current: 3, incremented: false });
  });
  it("spends one protection token to bridge a single missed day", () => {
    const base = { current: 3, longest: 3, lastQualifiedDate: "2026-09-17", protectionTokens: 1 };
    expect(advanceStreak(base, "2026-09-19")).toMatchObject({ current: 4, protectionTokens: 0, protectionUsed: true });
    expect(advanceStreak(base, "2026-09-21")).toMatchObject({ current: 1, protectionTokens: 1, protectionUsed: false });
  });
  it("shows 0 after a missed day unless protected", () => {
    expect(effectiveStreak({ current: 4, lastQualifiedDate: "2026-09-15", protectionTokens: 0 }, "2026-09-18")).toBe(0);
    expect(effectiveStreak({ current: 4, lastQualifiedDate: "2026-09-16", protectionTokens: 1 }, "2026-09-18")).toBe(4);
  });
  it("awards each milestone once", () => {
    expect(newMilestones(7, [1, 7, 30], [1])).toEqual([7]);
    expect(newMilestones(7, [1, 7, 30], [1, 7])).toEqual([]);
  });
});

describe("mastery", () => {
  const empty = emptyMastery("u1", "t1", "c1", "physics", 9);
  const at = Date.parse("2026-09-18T00:00:00Z");
  it("stays unrated until three attempts", () => {
    const once = mergeMastery(empty, { questionId: "q1", correct: true, difficulty: 1, timeTakenSec: 10, atMs: at, context: "practice" }, 20);
    expect(once.strength).toBe("unrated");
    expect(once.attempts).toBe(1);
  });
  it("rewards accuracy on harder questions more and penalises repeated mistakes", () => {
    let strong = empty;
    let weak = empty;
    for (let index = 0; index < 6; index += 1) {
      strong = mergeMastery(strong, { questionId: `q${index}`, correct: true, difficulty: 3, timeTakenSec: 30, atMs: at, context: "practice" }, 20);
      weak = mergeMastery(weak, { questionId: `q${index}`, correct: index % 3 === 0, difficulty: 1, timeTakenSec: 30, atMs: at, context: "practice" }, 20);
    }
    expect(strong.strength).toBe("strong");
    expect(weak.strength).toBe("weak");
    expect(strong.mastery).toBeGreaterThan(weak.mastery);
  });
  it("decays with recency and caps coverage", () => {
    const doc = { recent: [{ correct: true, difficulty: 2 as const, at }], assessmentAttempts: 0, assessmentCorrect: 0, distinctQuestionIds: ["q1"] };
    const fresh = computeMastery(doc, 20, at, at);
    const stale = computeMastery(doc, 20, at + 60 * 86_400_000, at);
    expect(fresh).toBeGreaterThan(stale);
    expect(computeMastery({ ...doc, distinctQuestionIds: ["a", "b", "c", "d"] }, 2, at, at)).toBe(computeMastery({ ...doc, distinctQuestionIds: ["a", "b"] }, 2, at, at));
  });
  it("classifies by fixed bands", () => {
    expect(classify(80, 5)).toBe("strong");
    expect(classify(60, 5)).toBe("good");
    expect(classify(40, 5)).toBe("needs_practice");
    expect(classify(10, 5)).toBe("weak");
    expect(classify(90, 2)).toBe("unrated");
  });
});

describe("grading", () => {
  const key: QuestionKeyDoc = { id: "q", correctIndexes: [1], numericAnswer: null, tolerance: 0, explanation: "" };
  it("grades single-choice, multi-choice and numerical answers", () => {
    expect(gradeAnswer("mcq", key, { indexes: [1] })).toBe(true);
    expect(gradeAnswer("mcq", key, { indexes: [0] })).toBe(false);
    expect(gradeAnswer("multi", { ...key, correctIndexes: [0, 2] }, { indexes: [0, 2] })).toBe(true);
    expect(gradeAnswer("multi", { ...key, correctIndexes: [0, 2] }, { indexes: [0] })).toBe(false);
    expect(gradeAnswer("numerical", { ...key, correctIndexes: [], numericAnswer: 9.8, tolerance: 0.1 }, { value: "9.85 m/s^2" })).toBe(true);
    expect(gradeAnswer("numerical", { ...key, correctIndexes: [], numericAnswer: 9.8, tolerance: 0.1 }, { value: "10" })).toBe(false);
    expect(gradeAnswer("numerical", { ...key, correctIndexes: [], numericAnswer: 9.8, tolerance: 0.1 }, { indexes: [0] })).toBe(false);
  });
  it("rejects malformed answers before grading", () => {
    expect(parseSubmittedAnswer({ indexes: [5] }, "mcq", 4)).toBeNull();
    expect(parseSubmittedAnswer({ indexes: [0, 1] }, "mcq", 4)).toBeNull();
    expect(parseSubmittedAnswer({ indexes: [1, 0] }, "multi", 4)).toEqual({ indexes: [0, 1] });
    expect(parseSubmittedAnswer({ value: "" }, "numerical", 0)).toBeNull();
    expect(parseSubmittedAnswer("3", "numerical", 0)).toBeNull();
  });
});

describe("spin", () => {
  it("enforces the cooldown and picks deterministically by weight", () => {
    expect(canSpin(null, 10)).toBe(true);
    expect(canSpin(20, 10)).toBe(false);
    const outcomes = [
      { label: "a", weight: 1, xp: 0, coins: 1, streakProtection: 0, badgeId: null },
      { label: "b", weight: 3, xp: 0, coins: 2, streakProtection: 0, badgeId: null }
    ];
    expect(pickOutcome(outcomes, 0.1).label).toBe("a");
    expect(pickOutcome(outcomes, 0.9).label).toBe("b");
  });
});

describe("AI validation and fallback", () => {
  const topic: TopicDoc = {
    id: "t", slug: "t", chapterId: "c", subjectId: "physics", category: null, classLevel: 9, name: "Motion", order: 1, hasContent: true,
    concept: "Concept text", keyPoints: ["k1"], formulae: ["v = u + at"], examples: [{ problem: "P1", solution: "S1" }], commonMistakes: ["m1"],
    revision: { concept: "c", formula: "f", commonMistake: "m", miniQuestion: { question: "Q?", answer: "A" } }
  };
  it("rejects empty, short and unsafe output and caps length", () => {
    expect(validateAiText("").ok).toBe(false);
    expect(validateAiText("hi").reason).toBe("too_short");
    expect(validateAiText("here is my api_key sk-abcdefghijklmnop").reason).toBe("unsafe");
    expect(validateAiText("x".repeat(5000)).text.endsWith("[Response shortened]")).toBe(true);
  });
  it("detects answer leaks in hint mode", () => {
    expect(leaksFinalAnswer("The answer is 17 m/s", ["17 m/s"])).toBe(true);
    expect(leaksFinalAnswer("Think about v = u + at", ["17 m/s"])).toBe(false);
  });
  it("flags messages that need the support notice", () => {
    expect(needsSupportNotice("I want to die, nothing works")).toBe(true);
    expect(needsSupportNotice("I keep failing this chapter")).toBe(false);
  });
  it("varies the explanation when the same concept is asked again", () => {
    const base = { mode: "explain" as const, topic, chapter: null, question: null, key: null, weakTopics: [], dailyGoalMinutes: 60, hintCount: 0 };
    const first = fallbackResponse({ ...base, explainCount: 0 });
    const second = fallbackResponse({ ...base, explainCount: 1 });
    expect(first).not.toBe(second);
    expect(second).toContain("example");
  });
  it("walks through hints one at a time without revealing the answer", () => {
    const question = { id: "q", topicId: "t", chapterId: "c", subjectId: "physics" as const, classLevel: 9 as const, type: "numerical" as const, difficulty: 1 as const, examTags: [], pyq: false, text: "", options: [], unit: null, hints: ["h1", "h2"], source: null };
    const base = { mode: "hint" as const, topic, chapter: null, question, key: null, weakTopics: [], dailyGoalMinutes: 60, explainCount: 0 };
    expect(fallbackResponse({ ...base, hintCount: 0 })).toContain("h1");
    expect(fallbackResponse({ ...base, hintCount: 5 })).toContain("h2");
  });
  it("splits the study plan to the exact daily goal", () => {
    const plan = planMinutes(60);
    expect(Object.values(plan).reduce((sum, value) => sum + value, 0)).toBe(60);
  });
});

describe("badges and ids", () => {
  it("awards only newly earned badges", () => {
    expect(badgesToAward({ lessonsCompleted: 1, questionsSolved: 0, assessmentsCompleted: 0, streakCurrent: 7 }, ["first_step"])).toEqual(["week_warrior"]);
    expect(badgesToAward({ lessonsCompleted: 1, questionsSolved: 1, assessmentsCompleted: 1, streakCurrent: 0 }, [])).toEqual(["first_step", "orbit_explorer"]);
  });
  it("derives stable anonymous names and well-formed invite codes", () => {
    expect(anonUsername("abc")).toBe(anonUsername("abc"));
    expect(inviteCode(() => 0)).toBe("EDU-AAAAA");
    expect(inviteCode()).toMatch(/^EDU-[A-Z2-9]{5}$/);
  });
});
