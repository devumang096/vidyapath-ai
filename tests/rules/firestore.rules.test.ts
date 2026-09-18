import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from "firebase/firestore";

// Security tests for spec section 99: every "a student cannot" case.
// Requires the Firestore emulator: firebase emulators:exec --only firestore "npm run test:rules"

let env: RulesTestEnvironment;
const STUDENT = "student_a";
const OTHER = "student_b";
const ADMIN = "admin_1";
const PREFS = { streak: true, dailyGoal: true, weakTopic: true, assessment: true, buddy: true, group: true, reward: true };

function studentProfile(uid: string, email: string) {
  return {
    uid, email, name: "Test", classLevel: 10, goal: "school", subjects: ["mathematics"], language: "en", learningLevel: "beginner", dailyGoalMinutes: 60,
    school: null, phone: null, photoURL: null, onboardingComplete: false, notificationPrefs: PREFS, role: "student",
    xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0, totalStudyMinutes: 0, activeDays: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "eduorbit-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${STUDENT}`), { ...studentProfile(STUDENT, "a@test.dev"), xp: 100, coins: 50 });
    await setDoc(doc(db, `users/${OTHER}`), { ...studentProfile(OTHER, "b@test.dev"), xp: 100, coins: 50 });
    await setDoc(doc(db, `streaks/${STUDENT}`), { uid: STUDENT, current: 3, longest: 3, lastQualifiedDate: "2026-09-17", protectionTokens: 0, milestonesAwarded: [] });
    await setDoc(doc(db, `topicMastery/${OTHER}_t1`), { id: `${OTHER}_t1`, userId: OTHER, topicId: "t1", mastery: 50 });
    await setDoc(doc(db, `topicMastery/${STUDENT}_t1`), { id: `${STUDENT}_t1`, userId: STUDENT, topicId: "t1", mastery: 50 });
    await setDoc(doc(db, `rewards/r1`), { id: "r1", name: "Notebook", coinPrice: 100, stock: 3, available: true });
    await setDoc(doc(db, `redemptions/c1`), { id: "c1", userId: OTHER, rewardId: "r1", status: "pending" });
    await setDoc(doc(db, `spinState/${STUDENT}`), { uid: STUDENT, nextSpinAt: null, totalSpins: 0 });
    await setDoc(doc(db, `questionKeys/q1`), { id: "q1", correctIndexes: [1], explanation: "x" });
    await setDoc(doc(db, `publicProfiles/${OTHER}`), { uid: OTHER, anonUsername: "CalmOtter42", classLevel: 10 });
    await setDoc(doc(db, `buddies/p1`), { id: "p1", members: [OTHER, "someone"], status: "active" });
    await setDoc(doc(db, `groups/g1`), { id: "g1", name: "Secret", privacy: "private", ownerUid: OTHER });
    await setDoc(doc(db, `groups/g2`), { id: "g2", name: "Open", privacy: "public", ownerUid: OTHER });
    await setDoc(doc(db, `groupMembers/g1_${OTHER}`), { id: `g1_${OTHER}`, groupId: "g1", uid: OTHER, role: "owner" });
    await setDoc(doc(db, `groupMembers/g2_${STUDENT}`), { id: `g2_${STUDENT}`, groupId: "g2", uid: STUDENT, role: "member" });
    await setDoc(doc(db, `groupPosts/post1`), { id: "post1", groupId: "g1", authorUid: OTHER, hidden: false });
    await setDoc(doc(db, `groupPosts/post2`), { id: "post2", groupId: "g2", authorUid: OTHER, hidden: false });
  });
});

const asStudent = () => env.authenticatedContext(STUDENT, { email: "a@test.dev" }).firestore();
const asAdmin = () => env.authenticatedContext(ADMIN, { admin: true }).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

describe("unauthenticated access", () => {
  it("cannot read users or content", async () => {
    await assertFails(getDoc(doc(asAnon(), `users/${STUDENT}`)));
    await assertFails(getDoc(doc(asAnon(), `topics/t1`)));
    await assertFails(getDoc(doc(asAnon(), `groups/g2`)));
  });
});

describe("a student cannot", () => {
  it("read or modify another student's profile or progress", async () => {
    await assertFails(getDoc(doc(asStudent(), `users/${OTHER}`)));
    await assertFails(updateDoc(doc(asStudent(), `users/${OTHER}`), { name: "Hacked", updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(asStudent(), `topicMastery/${OTHER}_t1`)));
  });
  it("give themselves XP, coins, counters or a role", async () => {
    await assertFails(updateDoc(doc(asStudent(), `users/${STUDENT}`), { xp: 9999, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(asStudent(), `users/${STUDENT}`), { coins: 9999, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(asStudent(), `users/${STUDENT}`), { questionsSolved: 500, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(asStudent(), `users/${STUDENT}`), { role: "admin", updatedAt: serverTimestamp() }));
  });
  it("write streaks, spin state, mastery, attempts, sessions or ledgers", async () => {
    await assertFails(setDoc(doc(asStudent(), `streaks/${STUDENT}`), { current: 100 }, { merge: true }));
    await assertFails(setDoc(doc(asStudent(), `spinState/${STUDENT}`), { nextSpinAt: null }, { merge: true }));
    await assertFails(setDoc(doc(asStudent(), `topicMastery/${STUDENT}_t1`), { mastery: 100 }, { merge: true }));
    await assertFails(setDoc(doc(asStudent(), `questionAttempts/x`), { userId: STUDENT, correct: true }));
    await assertFails(setDoc(doc(asStudent(), `assessmentAttempts/x`), { userId: STUDENT, score: 100 }));
    await assertFails(setDoc(doc(asStudent(), `learningSessions/x`), { userId: STUDENT, minutes: 600 }));
    await assertFails(setDoc(doc(asStudent(), `xpTransactions/x`), { userId: STUDENT, amount: 1000 }));
    await assertFails(setDoc(doc(asStudent(), `coinTransactions/x`), { userId: STUDENT, amount: 1000 }));
  });
  it("redeem directly, change prices or stock, or touch another student's redemption", async () => {
    await assertFails(setDoc(doc(asStudent(), `redemptions/mine`), { userId: STUDENT, rewardId: "r1", status: "fulfilled" }));
    await assertFails(updateDoc(doc(asStudent(), `rewards/r1`), { coinPrice: 1 }));
    await assertFails(updateDoc(doc(asStudent(), `rewards/r1`), { stock: 999 }));
    await assertFails(getDoc(doc(asStudent(), `redemptions/c1`)));
  });
  it("read answer keys", async () => {
    await assertFails(getDoc(doc(asStudent(), `questionKeys/q1`)));
  });
  it("read a buddy pair they are not in, or write buddy requests", async () => {
    await assertFails(getDoc(doc(asStudent(), `buddies/p1`)));
    await assertFails(setDoc(doc(asStudent(), `buddyRequests/x`), { fromUid: STUDENT, toUid: OTHER, status: "accepted" }));
  });
  it("read private groups or their posts, or promote themselves", async () => {
    await assertFails(getDoc(doc(asStudent(), `groups/g1`)));
    await assertFails(getDoc(doc(asStudent(), `groupPosts/post1`)));
    await assertFails(setDoc(doc(asStudent(), `groupMembers/g1_${STUDENT}`), { groupId: "g1", uid: STUDENT, role: "owner" }));
    await assertFails(updateDoc(doc(asStudent(), `groupMembers/g2_${STUDENT}`), { role: "admin" }));
    await assertFails(setDoc(doc(asStudent(), `groups/g3`), { id: "g3", name: "Mine", privacy: "public", ownerUid: STUDENT }));
  });
  it("register with a non-student role, a non-zero balance or a foreign subject", async () => {
    const fresh = env.authenticatedContext("new_user", { email: "n@test.dev" }).firestore();
    await assertFails(setDoc(doc(fresh, "users/new_user"), { ...studentProfile("new_user", "n@test.dev"), role: "admin" }));
    await assertFails(setDoc(doc(fresh, "users/new_user"), { ...studentProfile("new_user", "n@test.dev"), coins: 500 }));
    await assertFails(setDoc(doc(fresh, "users/new_user"), { ...studentProfile("new_user", "n@test.dev"), subjects: ["english"] }));
    await assertFails(setDoc(doc(fresh, "users/new_user"), { ...studentProfile("new_user", "n@test.dev"), goal: "board" }));
  });
});

describe("a student can", () => {
  it("register with a valid profile and edit preferences only", async () => {
    const fresh = env.authenticatedContext("new_user", { email: "n@test.dev" }).firestore();
    await assertSucceeds(setDoc(doc(fresh, "users/new_user"), studentProfile("new_user", "n@test.dev")));
    await assertSucceeds(updateDoc(doc(fresh, "users/new_user"), { dailyGoalMinutes: 90, onboardingComplete: true, subjects: ["physics", "biology"], updatedAt: serverTimestamp() }));
  });
  it("read own data and public content, public groups and own group's posts", async () => {
    await assertSucceeds(getDoc(doc(asStudent(), `users/${STUDENT}`)));
    await assertSucceeds(getDoc(doc(asStudent(), `topicMastery/${STUDENT}_t1`)));
    await assertSucceeds(getDoc(doc(asStudent(), `rewards/r1`)));
    await assertSucceeds(getDoc(doc(asStudent(), `publicProfiles/${OTHER}`)));
    await assertSucceeds(getDoc(doc(asStudent(), `groups/g2`)));
    await assertSucceeds(getDoc(doc(asStudent(), `groupPosts/post2`)));
    await assertSucceeds(getDocs(query(collection(asStudent(), "topicMastery"), where("userId", "==", STUDENT))));
  });
  it("file a report, block a user, save buddy preferences and manage projects", async () => {
    await assertSucceeds(setDoc(doc(asStudent(), "reports/rep1"), { reporterId: STUDENT, targetType: "user", targetId: OTHER, groupId: null, reason: "spam", details: "", status: "open", createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(asStudent(), `blocks/${STUDENT}/users/${OTHER}`), { blockedUid: OTHER, createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(asStudent(), `buddyPreferences/${STUDENT}`), { uid: STUDENT, open: true, subjects: ["physics"], schedule: "evening", genderPreference: "any", gender: "unspecified", updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(asStudent(), "projects/p1"), { id: "p1", userId: STUDENT, name: "Science fair", description: "", goal: "", startDate: null, deadline: null, status: "not_started", notes: "", resources: [], taskCount: 0, completedTaskCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(asStudent(), "projectTasks/t1"), { id: "t1", projectId: "p1", userId: STUDENT, title: "Plan", done: false, dueDate: null, order: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(asStudent(), "projects/p2"), { id: "p2", userId: OTHER, name: "Not mine", description: "", goal: "", startDate: null, deadline: null, status: "not_started", notes: "", resources: [], taskCount: 0, completedTaskCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe("an admin can", () => {
  it("resolve reports, update redemption status and store stock, but still not write ledgers", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "reports/rep2"), { reporterId: OTHER, targetType: "user", targetId: STUDENT, groupId: null, reason: "spam", details: "", status: "open", createdAt: serverTimestamp() });
    });
    await assertSucceeds(updateDoc(doc(asAdmin(), "reports/rep2"), { status: "resolved" }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "redemptions/c1"), { status: "fulfilled" }));
    await assertSucceeds(updateDoc(doc(asAdmin(), "rewards/r1"), { stock: 10 }));
    await assertFails(setDoc(doc(asAdmin(), `xpTransactions/x`), { userId: STUDENT, amount: 1000 }));
    await assertFails(setDoc(doc(asAdmin(), `streaks/${STUDENT}`), { current: 100 }, { merge: true }));
    expect((await getDoc(doc(asAdmin(), "redemptions/c1"))).get("status")).toBe("fulfilled");
  });
});
