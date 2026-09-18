import { describe, expect, it } from "vitest";
import { findContactSharing } from "../lib/safety.js";
import { countActivity, createChallenge, rankCandidates, refreshChallenge, respondRequest, roomAction, runningSeconds, sendRequest, sessionDoc, unmatch } from "../lib/buddy.js";
import type { OutcomeContext } from "../lib/outcome.js";
import type { Clock, WriteOp } from "../lib/writes.js";
import { DEFAULT_NOTIFICATION_PREFS, type BuddyPairDoc, type BuddyPreferencesDoc, type BuddyRequestDoc, type PublicProfile, type RewardConfig } from "../types.js";

const config = { challengeXp: 150, challengeCoins: 20, studyMinuteXp: 1, streakDayMinutes: 20, streakDayQuestions: 10, streakMilestones: [1] } as RewardConfig;
const at = (ms: number): Clock => ({ now: new Date(ms), today: "2026-09-19", stamp: new Date(ms), newId: () => "n" });
const T0 = Date.parse("2026-09-19T05:00:00Z");

function profile(uid: string, overrides: Partial<PublicProfile> = {}): PublicProfile {
  return { uid, anonUsername: `Anon${uid}`, avatar: "avatar-1", classLevel: 10, goal: "school", subjects: ["physics", "chemistry"], language: "en", learningLevel: "beginner", progressSummary: { accuracy: 0, questionsSolved: 0, lessonsCompleted: 0 }, buddyStatus: "none", buddyPairId: null, updatedAt: null, ...overrides };
}
function prefs(uid: string, overrides: Partial<BuddyPreferencesDoc> = {}): BuddyPreferencesDoc {
  return { uid, open: true, subjects: ["physics"], schedule: "evening", genderPreference: "any", gender: "unspecified", updatedAt: null, ...overrides };
}
function ctx(uid: string, overrides: Partial<OutcomeContext> = {}): OutcomeContext {
  return {
    uid, config,
    user: { uid, email: "", name: "", classLevel: 10, goal: "school", subjects: ["physics"], language: "en", learningLevel: "beginner", dailyGoalMinutes: 60, school: null, phone: null, photoURL: null, onboardingComplete: true, notificationPrefs: DEFAULT_NOTIFICATION_PREFS, role: "student", xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0, totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: null, updatedAt: null },
    streak: { current: 0, longest: 0, lastQualifiedDate: null, protectionTokens: 0, milestonesAwarded: [] },
    activity: { minutes: 0, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: false },
    eventDone: false, ...overrides
  };
}
const find = (writes: WriteOp[], path: string) => (writes.find((write) => write.path === path) as { data: Record<string, unknown> } | undefined)?.data;
const pair: BuddyPairDoc = { id: "p1", members: ["a", "b"], classLevel: 10, status: "active", endedBy: null, createdAt: null, endedAt: null };

describe("matching", () => {
  it("requires same class, open preferences and no block, and ranks by goal, subjects, level, language and schedule", () => {
    const me = { profile: profile("me", { goal: "jee", learningLevel: "advanced" }), prefs: prefs("me") };
    const ranked = rankCandidates(me, [
      { profile: profile("best", { goal: "jee", learningLevel: "advanced" }), prefs: prefs("best") },
      { profile: profile("ok", { goal: "school", subjects: ["biology"] }), prefs: prefs("ok", { schedule: "morning" }) },
      { profile: profile("otherclass", { classLevel: 11 }), prefs: prefs("otherclass") },
      { profile: profile("closed"), prefs: prefs("closed", { open: false }) },
      { profile: profile("matched", { buddyStatus: "matched" }), prefs: prefs("matched") },
      { profile: profile("blocked"), prefs: prefs("blocked") }
    ], new Set(["blocked"]));
    expect(ranked.map((row) => row.uid)).toEqual(["best", "ok"]);
    expect(ranked[0].reasons).toContain("Same goal");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(Object.keys(ranked[0])).not.toContain("email");
  });
  it("honours a same-gender preference from either side", () => {
    const me = { profile: profile("me"), prefs: prefs("me", { gender: "female", genderPreference: "same" }) };
    const ranked = rankCandidates(me, [
      { profile: profile("f"), prefs: prefs("f", { gender: "female" }) },
      { profile: profile("m"), prefs: prefs("m", { gender: "male" }) },
      { profile: profile("u"), prefs: prefs("u") }
    ], new Set());
    expect(ranked.map((row) => row.uid)).toEqual(["f"]);
  });
});

describe("requests and pairs", () => {
  const base = { fromUid: "a", toUid: "b", message: "Hi", requestId: "r1", blockedEitherWay: false, fromProfile: profile("a"), toProfile: profile("b"), toPrefsOpen: true, existingBetween: null, recipientNotify: true, clock: at(T0) };
  it("creates a pending request with a notification and refuses blocked, matched, closed or duplicate targets", () => {
    const { writes } = sendRequest(base);
    expect(find(writes, "buddyRequests/r1")).toMatchObject({ status: "pending", fromUid: "a", toUid: "b" });
    expect(writes.some((write) => write.path.startsWith("notifications/b/"))).toBe(true);
    expect(() => sendRequest({ ...base, toUid: "a" })).toThrow(/yourself/);
    expect(() => sendRequest({ ...base, message: "Call me at 98765 43210" })).toThrow(/phone number/);
    expect(() => sendRequest({ ...base, message: "mail me a@b.com" })).toThrow(/email address/);
    expect(() => sendRequest({ ...base, message: "insta @some_handle" })).toThrow(/handle|messaging/);
    expect(() => sendRequest({ ...base, message: "Chapter 3 at 7 pm? I scored 19/20 today" })).not.toThrow();
    expect(() => sendRequest({ ...base, blockedEitherWay: true })).toThrow(/not available/);
    expect(() => sendRequest({ ...base, toProfile: profile("b", { buddyStatus: "matched" }) })).toThrow(/not looking/);
    expect(() => sendRequest({ ...base, toPrefsOpen: false })).toThrow(/not looking/);
    expect(() => sendRequest({ ...base, existingBetween: { id: "x", fromUid: "b", toUid: "a", message: "", status: "pending", createdAt: null, respondedAt: null } })).toThrow(/already pending/);
  });
  it("accepts only by the recipient, creates the pair, marks both profiles and seeds the live room", () => {
    const request: BuddyRequestDoc = { id: "r1", fromUid: "a", toUid: "b", message: "", status: "pending", createdAt: null, respondedAt: null };
    expect(() => respondRequest({ uid: "a", request, accept: true, fromProfile: profile("a"), toProfile: profile("b"), pairId: "p1", clock: at(T0) })).toThrow(/recipient/);
    const { writes, result } = respondRequest({ uid: "b", request, accept: true, fromProfile: profile("a"), toProfile: profile("b"), pairId: "p1", clock: at(T0) });
    expect(result).toEqual({ status: "accepted", pairId: "p1" });
    expect(find(writes, "buddies/p1")).toMatchObject({ members: ["a", "b"], status: "active" });
    expect(find(writes, "publicProfiles/a")).toMatchObject({ buddyStatus: "matched", buddyPairId: "p1" });
    expect(find(writes, "buddySessions/p1_live")).toMatchObject({ status: "idle" });
    const declined = respondRequest({ uid: "b", request, accept: false, fromProfile: profile("a"), toProfile: profile("b"), pairId: "p2", clock: at(T0) });
    expect(declined.result.status).toBe("declined");
    expect(declined.writes).toHaveLength(1);
  });
  it("unmatch ends the pair for a member only and frees both profiles", () => {
    expect(() => unmatch("c", pair, at(T0))).toThrow(/not in this Buddy pair/);
    const writes = unmatch("a", pair, at(T0));
    expect(find(writes, "buddies/p1")).toMatchObject({ status: "ended", endedBy: "a" });
    expect(find(writes, "publicProfiles/b")).toMatchObject({ buddyStatus: "none", buddyPairId: null });
  });
});

describe("study room", () => {
  it("credits time per present participant across start, leave, pause, resume and stop, and pays study minutes once", () => {
    let session = sessionDoc(null, "p1", ["a", "b"]);
    const step = (uid: string, action: Parameters<typeof roomAction>[0]["action"], ms: number, contexts = new Map<string, OutcomeContext>()) => {
      const { writes, result } = roomAction({ uid, pair, session, action, contexts, historyId: "p1_h1", clock: at(ms) });
      session = { ...session, ...(find(writes, "buddySessions/p1_live") as Partial<typeof session>) };
      return { writes, result };
    };
    step("a", "start", T0);
    step("b", "join", T0 + 60_000);
    expect(runningSeconds(session, T0 + 120_000)).toBe(120);
    step("b", "leave", T0 + 180_000);
    step("a", "pause", T0 + 300_000);
    expect(session.status).toBe("paused");
    expect(session.participants.a.seconds).toBe(300);
    expect(session.participants.b.seconds).toBe(120);
    expect(() => step("a", "reset", T0 + 301_000)).not.toThrow();
    session = sessionDoc(null, "p1", ["a", "b"]);
    step("a", "start", T0);
    step("b", "join", T0);
    const contexts = new Map([["a", ctx("a")], ["b", ctx("b")]]);
    const { writes, result } = step("a", "stop", T0 + 25 * 60_000, contexts);
    expect(result.status).toBe("stopped");
    expect(result.credited.a.minutes).toBe(25);
    expect(result.credited.b.minutes).toBe(25);
    expect(find(writes, "buddySessions/p1_h1")).toMatchObject({ finalizedAt: new Date(T0 + 25 * 60_000) });
    expect(find(writes, "learningSessions/session_a_buddy-p1_h1")).toMatchObject({ kind: "buddy", minutes: 25 });
    expect(find(writes, "users/b")).toMatchObject({ totalStudyMinutes: 25, xp: 25 });
    expect(result.credited.a.rewards?.streak.qualifiedToday).toBe(true);
    const replay = roomAction({ uid: "a", pair, session: { ...session, status: "paused" }, action: "stop", contexts: new Map([["a", ctx("a", { eventDone: true })]]), historyId: "p1_h1", clock: at(T0 + 26 * 60_000) });
    expect(replay.result.credited.a.minutes).toBe(0);
    expect(() => roomAction({ uid: "c", pair, session, action: "start", contexts, historyId: "x", clock: at(T0) })).toThrow(/not in this Buddy pair/);
  });
});

describe("contact sharing filter", () => {
  it("catches phones, emails, handles, links and app names but not study talk", () => {
    expect(findContactSharing("9876543210")).toBe("a phone number");
    expect(findContactSharing("+91 98765 43210")).toBe("a phone number");
    expect(findContactSharing("me@example.com")).toBe("an email address");
    expect(findContactSharing("find me @priya_n")).toBe("a social media handle");
    expect(findContactSharing("see www.example.com")).toBe("a link");
    expect(findContactSharing("ping me on whatsapp")).toBe("a messaging app contact");
    expect(findContactSharing("v = u + at, page 42, 20 questions at 7 pm")).toBeNull();
  });
});

describe("challenges", () => {
  it("validates targets, tracks progress from validated activity and pays each member once when both finish", () => {
    expect(() => createChallenge({ uid: "a", pair, kind: "questions", target: 2, days: 7, challengeId: "c1", clock: at(T0) })).toThrow(/between 5 and 500/);
    const { writes } = createChallenge({ uid: "a", pair, kind: "questions", target: 5, days: 7, challengeId: "c1", clock: at(T0) });
    const challenge = find(writes, "buddyChallenges/c1") as never as Parameters<typeof refreshChallenge>[0]["challenge"];
    expect(challenge).toMatchObject({ title: "Solve 5 questions each", progress: { a: 0, b: 0 } });
    const partial = refreshChallenge({ uid: "a", challenge, counts: { a: 5, b: 3 }, contexts: new Map(), clock: at(T0 + 1) });
    expect(partial.result).toMatchObject({ completed: false, progress: { a: 5, b: 3 } });
    const contexts = new Map([["a", ctx("a")], ["b", ctx("b")]]);
    const done = refreshChallenge({ uid: "b", challenge, counts: { a: 9, b: 5 }, contexts, clock: at(T0 + 2) });
    expect(done.result).toMatchObject({ completed: true, rewarded: ["a", "b"], progress: { a: 5, b: 5 } });
    expect(find(done.writes, "users/a")).toMatchObject({ xp: 150, coins: 20 });
    const again = refreshChallenge({ uid: "b", challenge: { ...challenge, completed: true, rewardedUids: ["a", "b"] }, counts: { a: 9, b: 9 }, contexts, clock: at(T0 + 3) });
    expect(again.result.rewarded).toEqual([]);
    const expired = refreshChallenge({ uid: "b", challenge, counts: { a: 9, b: 9 }, contexts, clock: at(T0 + 8 * 86_400_000) });
    expect(expired.result.completed).toBe(false);
    expect(() => refreshChallenge({ uid: "z", challenge, counts: {}, contexts, clock: at(T0) })).toThrow(/not in this challenge/);
  });
  it("counts only validated activity after the start time", () => {
    const docs = { learningSessions: [{ minutes: 20, createdAt: new Date(T0 + 1) }, { minutes: 20, createdAt: new Date(T0 - 1) }], questionAttempts: [{ correct: true, createdAt: new Date(T0 + 1) }, { correct: false, createdAt: new Date(T0 + 1) }], chapterProgress: [{ completed: true, completedAt: new Date(T0 + 1) }], assessmentAttempts: [{ finalized: true, finalizedAt: new Date(T0 + 1) }] };
    expect(countActivity("study_minutes", docs, T0)).toBe(20);
    expect(countActivity("questions", docs, T0)).toBe(1);
    expect(countActivity("chapter", docs, T0)).toBe(1);
    expect(countActivity("assessment", docs, T0)).toBe(1);
  });
});
