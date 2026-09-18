import { beforeEach, describe, expect, it } from "vitest";
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where } from "../firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut } from "../auth";
import { httpsCallable } from "../functions";
import { listDocs, resetStore, Timestamp } from "../store";
import { seedUserDocs } from "../seedData";
import type { DailyActivityDoc, PublicProfile, QuestionDoc, QuestionKeyDoc, RewardDoc, StreakDoc, TopicMasteryDoc, UserDoc } from "../../lib/types";

const AARAV = "demo-aarav";
const PRIYA = "demo-priya";
const call = <Input, Output>(name: string) => async (input: Input) => (await httpsCallable<Input, Output>({}, name)(input)).data;
const readUser = async (uid: string) => (await getDoc(doc(null, "users", uid))).data() as unknown as UserDoc;

async function login(email: string): Promise<void> {
  await signInWithEmailAndPassword({}, email, "demo1234");
}

beforeEach(() => {
  resetStore(seedUserDocs);
});

describe("firestore shim", () => {
  it("filters, orders and limits", async () => {
    const snapshot = await getDocs(query(collection(null, "chapters"), where("subjectId", "==", "physics"), where("classLevel", "==", 11), orderBy("order", "asc"), limit(5)));
    expect(snapshot.size).toBe(5);
    expect(snapshot.docs[0].data().name).toBe("Units and Measurements");
  });

  it("supports documentId() in, array-contains and range filters", async () => {
    const byId = await getDocs(query(collection(null, "questions"), where(documentId(), "in", ["9-physics-motion-equations-of-motion-q1", "9-physics-motion-equations-of-motion-q2"])));
    expect(byId.size).toBe(2);
    const jee = await getDocs(query(collection(null, "chapters"), where("examTags", "array-contains", "jee"), where("subjectId", "==", "biology")));
    expect(jee.size).toBe(0);
    await setDoc(doc(null, "dailyActivity/x_2026-09-10"), { uid: "x", date: "2026-09-10", createdAt: serverTimestamp() });
    const range = await getDocs(query(collection(null, "dailyActivity"), where("uid", "==", "x"), where("date", ">=", "2026-09-01"), where("date", "<=", "2026-09-31")));
    expect(range.size).toBe(1);
    expect(range.docs[0].data().createdAt).toBeInstanceOf(Timestamp);
  });

  it("only ever contains the four subjects", async () => {
    const subjects = await getDocs(collection(null, "subjects"));
    expect(subjects.docs.map((item) => item.id).sort()).toEqual(["biology", "chemistry", "mathematics", "physics"]);
    const chapterSubjects = new Set(listDocs("chapters").map((row) => row.data.subjectId));
    expect([...chapterSubjects].sort()).toEqual(["biology", "chemistry", "mathematics", "physics"]);
  });
});

describe("auth shim", () => {
  it("signs in demo accounts, rejects wrong passwords and creates new accounts", async () => {
    await expect(signInWithEmailAndPassword({}, "aarav@eduorbit.demo", "nope")).rejects.toMatchObject({ code: "auth/invalid-credential" });
    await login("aarav@eduorbit.demo");
    await signOut();
    const created = await createUserWithEmailAndPassword({}, "new@eduorbit.demo", "secret1");
    expect(created.user.emailVerified).toBe(false);
    await expect(createUserWithEmailAndPassword({}, "new@eduorbit.demo", "secret1")).rejects.toMatchObject({ code: "auth/email-already-in-use" });
  });

  it("signs in a Google-style account without a profile so the complete-profile flow runs", async () => {
    const { user } = await signInWithPopup({}, {});
    expect(user.providerData[0].providerId).toBe("google.com");
    expect((await getDoc(doc(null, "users", user.uid))).exists()).toBe(false);
  });
});

describe("seeded history", () => {
  it("gives Aarav real, engine-produced numbers and a streak with one gap", async () => {
    const user = await readUser(AARAV);
    expect(user.lessonsCompleted).toBeGreaterThan(0);
    expect(user.questionsSolved).toBeGreaterThan(0);
    expect(user.xp).toBeGreaterThan(0);
    const ledger = listDocs("xpTransactions").filter((row) => row.data.userId === AARAV);
    expect(ledger.reduce((sum, row) => sum + (row.data.amount as number), 0)).toBe(user.xp);
    const streak = (await getDoc(doc(null, "streaks", AARAV))).data() as unknown as StreakDoc;
    expect(streak.current).toBe(4);
    expect(streak.longest).toBe(4);
    const mastery = listDocs("topicMastery").filter((row) => row.data.userId === AARAV).map((row) => row.data as unknown as TopicMasteryDoc);
    expect(mastery.length).toBeGreaterThan(2);
    expect(mastery.some((row) => row.strength !== "unrated")).toBe(true);
  });

  it("leaves Priya with an honest empty state", async () => {
    const user = await readUser(PRIYA);
    expect(user.xp).toBe(0);
    expect(listDocs("topicMastery").filter((row) => row.data.userId === PRIYA)).toHaveLength(0);
  });
});

describe("callables", () => {
  it("grades answers server-side, pays once, and mirrors mastery, activity and public profile", async () => {
    await login("priya@eduorbit.demo");
    const question = (await getDoc(doc(null, "questions", "9-physics-motion-equations-of-motion-q1"))).data() as unknown as QuestionDoc;
    const key = (await getDoc(doc(null, "questionKeys", question.id))).data() as unknown as QuestionKeyDoc;
    const submit = call<{ attemptId: string; questionId: string; answer: unknown; timeTakenSec: number; context: string }, { correct: boolean; rewarded: boolean; explanation: string; mastery: number }>("submitAnswer");
    const wrongIndex = question.options.findIndex((_, index) => !key.correctIndexes.includes(index));
    const wrong = await submit({ attemptId: "a1", questionId: question.id, answer: { indexes: [wrongIndex] }, timeTakenSec: 12, context: "practice" });
    expect(wrong.correct).toBe(false);
    expect(wrong.rewarded).toBe(false);
    expect(wrong.explanation.length).toBeGreaterThan(0);
    const right = await submit({ attemptId: "a2", questionId: question.id, answer: { indexes: key.correctIndexes }, timeTakenSec: 20, context: "practice" });
    expect(right.correct).toBe(true);
    expect(right.rewarded).toBe(true);
    const again = await submit({ attemptId: "a3", questionId: question.id, answer: { indexes: key.correctIndexes }, timeTakenSec: 5, context: "practice" });
    expect(again.rewarded).toBe(false);
    const replay = await submit({ attemptId: "a2", questionId: question.id, answer: { indexes: key.correctIndexes }, timeTakenSec: 20, context: "practice" });
    expect(replay).toMatchObject({ alreadySubmitted: true });
    const user = await readUser(PRIYA);
    expect(user.questionsSolved).toBe(1);
    expect(user.xp).toBe(10);
    expect(user.coins).toBe(1);
    const mastery = (await getDoc(doc(null, "topicMastery", `${PRIYA}_${question.topicId}`))).data() as unknown as TopicMasteryDoc;
    expect(mastery.attempts).toBe(3);
    expect(mastery.correct).toBe(2);
    const activity = (await getDocs(query(collection(null, "dailyActivity"), where("uid", "==", PRIYA)))).docs[0].data() as unknown as DailyActivityDoc;
    expect(activity.questions).toBe(3);
    expect(activity.topicIds).toContain(question.topicId);
    const profile = (await getDoc(doc(null, "publicProfiles", PRIYA))).data() as unknown as PublicProfile;
    expect(profile.progressSummary.questionsSolved).toBe(1);
    await expect(submit({ attemptId: "a4", questionId: question.id, answer: { indexes: [9] }, timeTakenSec: 1, context: "practice" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  it("completes a lesson once and finishes the chapter when every lesson is done", async () => {
    await login("priya@eduorbit.demo");
    const complete = call<{ lessonId: string }, { alreadyCompleted: boolean; chapterCompleted: boolean }>("completeLesson");
    const lessons = listDocs("lessons").filter((row) => row.data.chapterId === "9-physics-motion").map((row) => row.id);
    expect(lessons.length).toBeGreaterThan(0);
    let chapterCompleted = false;
    for (const lessonId of lessons) chapterCompleted = (await complete({ lessonId })).chapterCompleted;
    expect(chapterCompleted).toBe(true);
    expect((await complete({ lessonId: lessons[0] })).alreadyCompleted).toBe(true);
    const user = await readUser(PRIYA);
    expect(user.lessonsCompleted).toBe(lessons.length);
    expect(user.chaptersCompleted).toBe(1);
    expect(user.coins).toBe(25);
  });

  it("caps study sessions and counts them toward the streak", async () => {
    await login("priya@eduorbit.demo");
    const record = call<{ sessionId: string; topicId: null; minutes: number; kind: string }, { minutesCounted: number; rewards: { streak: { qualifiedToday: boolean } } }>("recordStudySession");
    const first = await record({ sessionId: "s1", topicId: null, minutes: 25, kind: "learning" });
    expect(first.minutesCounted).toBe(25);
    expect(first.rewards.streak.qualifiedToday).toBe(true);
    await expect(record({ sessionId: "s2", topicId: null, minutes: 90, kind: "learning" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const streak = (await getDoc(doc(null, "streaks", PRIYA))).data() as unknown as StreakDoc;
    expect(streak.current).toBe(1);
  });

  it("redeems only with enough coins, stock and eligibility, then reduces stock", async () => {
    await login("aarav@eduorbit.demo");
    const redeem = call<{ rewardId: string; redemptionKey: string }, { alreadyRedeemed: boolean; coinsSpent: number; remainingCoins: number }>("redeemReward");
    const before = await readUser(AARAV);
    const cheap = listDocs("rewards").map((row) => row.data as unknown as RewardDoc).find((reward) => reward.coinPrice <= before.coins && reward.eligibility.minStreak === 0);
    expect(cheap).toBeDefined();
    const result = await redeem({ rewardId: cheap!.id, redemptionKey: "k1" });
    expect(result.coinsSpent).toBe(cheap!.coinPrice);
    expect((await readUser(AARAV)).coins).toBe(before.coins - cheap!.coinPrice);
    expect(((await getDoc(doc(null, "rewards", cheap!.id))).data() as unknown as RewardDoc).stock).toBe(cheap!.stock - 1);
    expect((await redeem({ rewardId: cheap!.id, redemptionKey: "k1" })).alreadyRedeemed).toBe(true);
    await expect(redeem({ rewardId: "bag", redemptionKey: "k2" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await readUser(AARAV)).coins).toBe(before.coins - cheap!.coinPrice);
  });

  it("spins once per cooldown and rejects a second spin", async () => {
    await login("priya@eduorbit.demo");
    const spin = call<Record<string, never>, { result: string; nextSpinAt: number }>("spinWheel");
    const first = await spin({});
    expect(first.nextSpinAt).toBeGreaterThan(Date.now());
    await expect(spin({})).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("answers OrbitAI from authored content, varies repeated explanations and stores the conversation", async () => {
    await login("aarav@eduorbit.demo");
    const ask = call<{ conversationId: string; mode: string; message?: string; topicId?: string }, { text: string; source: string; notice: string | null }>("askAi");
    const topicId = "9-physics-motion-equations-of-motion";
    const first = await ask({ conversationId: "c1", mode: "explain", topicId });
    const second = await ask({ conversationId: "c1", mode: "explain", topicId });
    expect(first.source).toBe("fallback");
    expect(first.notice).toContain("Demo mode");
    expect(first.text).not.toBe(second.text);
    const messages = await getDocs(query(collection(null, "aiMessages"), where("conversationId", "==", "c1"), orderBy("createdAt", "asc")));
    expect(messages.size).toBe(4);
    const support = await ask({ conversationId: "c1", mode: "explain", topicId, message: "I want to die, this makes no sense" });
    expect(support.text).toContain("trusted adult");
    await expect(ask({ conversationId: "c2", mode: "hint", topicId: "9-physics-motion-graphs" })).rejects.toMatchObject({ code: "functions/unavailable" });
  });

  it("deletes every document the student owns", async () => {
    await login("aarav@eduorbit.demo");
    await call<Record<string, never>, { deleted: boolean }>("deleteAccount")({});
    expect((await getDoc(doc(null, "users", AARAV))).exists()).toBe(false);
    expect(listDocs("topicMastery").some((row) => row.data.userId === AARAV)).toBe(false);
    expect(listDocs("xpTransactions").some((row) => row.data.userId === AARAV)).toBe(false);
  });
});
