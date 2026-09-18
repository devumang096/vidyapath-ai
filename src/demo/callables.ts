// Browser-side versions of the Cloud Functions, run against the demo store. All grading, reward,
// streak and mastery logic is the same code the server runs (functions/src/lib), so the demo
// behaves like production minus the network.
import type {
  AiMessageDoc, AiMode, ChapterDoc, LessonDoc, LessonProgressDoc, ChapterProgressDoc, PublicProfile, QuestionDoc, QuestionKeyDoc, RedemptionDoc, RewardDoc,
  SpinStateDoc, TopicDoc, TopicMasteryDoc, UserDoc
} from "../lib/types";
import { applyWrites } from "../../functions/src/lib/writes.js";
import { toMillis } from "../../functions/src/lib/outcome.js";
import { completeLesson, LogicError, recordSession, SESSION_KINDS, submitAnswer } from "../../functions/src/lib/learning.js";
import { redeem, spin } from "../../functions/src/lib/rewards.js";
import { parseSubmittedAnswer } from "../../functions/src/lib/grading.js";
import { fallbackResponse, planMinutes } from "../../functions/src/lib/aiFallback.js";
import { needsSupportNotice, SUPPORT_NOTICE } from "../../functions/src/lib/aiValidate.js";
import { anonUsername, avatarFor } from "./hash";
import { contextFrom, demoClock } from "./engine";
import { DemoError, listDocs, newDocId, onWrite, readDoc, removeDoc, runQuery, storeSink, Timestamp, writeDoc, type DocData } from "./store";

type Input = Record<string, unknown>;
type Handler = (uid: string, input: Input) => Promise<unknown>;

const AI_MODES = new Set<AiMode>(["explain", "solve", "hint", "quiz", "revision", "mistake_analysis", "study_planner"]);
const DEMO_AI_NOTICE = "Demo mode: OrbitAI is not connected to an AI key, so this is the content-authored explanation.";

function getDoc<T>(path: string): T | null {
  return readDoc(path) as T | null;
}
function requireDoc<T>(path: string, message: string, code = "not-found"): T {
  const data = getDoc<T>(path);
  if (!data) throw new DemoError(code, message);
  return data;
}
function requireString(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DemoError("invalid-argument", `Invalid ${name}.`);
  return value.trim();
}
function requireNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new DemoError("invalid-argument", `Invalid ${name}.`);
  return value;
}
function count(path: string, field: string, value: unknown): number {
  return runQuery({ path, filters: [{ field, op: "==", value }], orders: [], max: null }).length;
}
function run<T>(uid: string, eventId: string, work: (ctx: ReturnType<typeof contextFrom>, clock: ReturnType<typeof demoClock>) => { writes: Parameters<typeof applyWrites>[1]; result: T }): T {
  const clock = demoClock();
  const ctx = contextFrom(readDoc, uid, eventId, clock);
  try {
    const { writes, result } = work(ctx, clock);
    applyWrites(storeSink, writes);
    return result;
  } catch (error) {
    if (error instanceof LogicError) throw new DemoError(error.code, error.message);
    throw error;
  }
}

export const callables: Record<string, Handler> = {
  async startLesson(uid, input) {
    const lessonId = requireString(input.lessonId, "lessonId");
    const lesson = requireDoc<LessonDoc>(`lessons/${lessonId}`, "Lesson not found.");
    const path = `lessonProgress/${uid}_${lessonId}`;
    const existing = getDoc<LessonProgressDoc>(path);
    if (existing) return { status: existing.status };
    writeDoc(path, { lessonId, userId: uid, topicId: lesson.topicId, chapterId: lesson.chapterId, subjectId: lesson.subjectId, status: "started", startedAt: Timestamp.now(), completedAt: null });
    return { status: "started" };
  },

  async completeLesson(uid, input) {
    const lessonId = requireString(input.lessonId, "lessonId");
    const lesson = requireDoc<LessonDoc>(`lessons/${lessonId}`, "Lesson not found.");
    return run(uid, `lesson_${uid}_${lessonId}`, (ctx, clock) =>
      completeLesson({
        ctx,
        clock,
        lesson,
        progress: getDoc<LessonProgressDoc>(`lessonProgress/${uid}_${lessonId}`),
        chapterProgress: getDoc<ChapterProgressDoc>(`chapterProgress/${uid}_${lesson.chapterId}`),
        lessonsInChapter: count("lessons", "chapterId", lesson.chapterId)
      })
    );
  },

  async submitAnswer(uid, input) {
    const attemptId = requireString(input.attemptId, "attemptId", 80);
    const questionId = requireString(input.questionId, "questionId");
    const question = requireDoc<QuestionDoc>(`questions/${questionId}`, "Question not found.");
    const key = requireDoc<QuestionKeyDoc>(`questionKeys/${questionId}`, "Question not found.");
    const answer = parseSubmittedAnswer(input.answer, question.type, question.options.length);
    if (!answer) throw new DemoError("invalid-argument", "Invalid answer.");
    const timeTakenSec = requireNumber(input.timeTakenSec ?? 0, "timeTakenSec", 0, 36_000);
    const prior = runQuery({ path: "questionAttempts", filters: [{ field: "userId", op: "==", value: uid }, { field: "questionId", op: "==", value: questionId }], orders: [], max: null });
    return run(uid, `answer_${uid}_${attemptId}`, (ctx, clock) =>
      submitAnswer({
        ctx,
        clock,
        attemptId,
        question,
        key,
        answer,
        timeTakenSec,
        context: input.context === "topic" ? "topic" : "practice",
        mastery: getDoc<TopicMasteryDoc>(`topicMastery/${uid}_${question.topicId}`),
        priorAttempts: prior.length,
        solvedBefore: prior.some((row) => row.data.correct === true),
        poolSize: count("questions", "topicId", question.topicId)
      })
    );
  },

  async recordStudySession(uid, input) {
    const sessionId = requireString(input.sessionId, "sessionId", 80);
    const minutes = requireNumber(input.minutes, "minutes", 1, 60);
    const kind = requireString(input.kind, "kind", 20) as (typeof SESSION_KINDS)[number];
    if (!SESSION_KINDS.includes(kind)) throw new DemoError("invalid-argument", "Invalid session kind.");
    const topicId = typeof input.topicId === "string" ? input.topicId : null;
    return run(uid, `session_${uid}_${sessionId}`, (ctx, clock) => recordSession({ ctx, clock, sessionId, topicId, minutes, kind }));
  },

  async spinWheel(uid) {
    const state = getDoc<SpinStateDoc>(`spinState/${uid}`);
    const expectedSpins = state?.totalSpins ?? 0;
    return run(uid, `spin_${uid}_${expectedSpins + 1}`, (ctx, clock) => spin({ ctx, clock, state, expectedSpins, nextSpinAtMs: toMillis(state?.nextSpinAt), random: Math.random() }));
  },

  async redeemReward(uid, input) {
    const rewardId = requireString(input.rewardId, "rewardId");
    const redemptionKey = requireString(input.redemptionKey, "redemptionKey", 80);
    const redemptionId = `${uid}_${redemptionKey}`;
    const prior = runQuery({ path: "redemptions", filters: [{ field: "userId", op: "==", value: uid }, { field: "rewardId", op: "==", value: rewardId }], orders: [], max: 1 });
    return run(uid, `redeem_${redemptionId}`, (ctx, clock) =>
      redeem({ ctx, clock, reward: getDoc<RewardDoc>(`rewards/${rewardId}`), redemptionKey, existing: getDoc<RedemptionDoc>(`redemptions/${redemptionId}`), redeemedBefore: prior.length > 0, streakCurrent: ctx.streak.current })
    );
  },

  async askAi(uid, input) {
    const conversationId = requireString(input.conversationId, "conversationId", 80);
    const mode = requireString(input.mode, "mode", 30) as AiMode;
    if (!AI_MODES.has(mode)) throw new DemoError("invalid-argument", "Unknown mode.");
    const message = typeof input.message === "string" ? input.message.slice(0, 1500).trim() : "";
    const topicId = typeof input.topicId === "string" ? input.topicId : null;
    const chapterId = typeof input.chapterId === "string" ? input.chapterId : null;
    const questionId = typeof input.questionId === "string" ? input.questionId : null;
    const user = requireDoc<UserDoc>(`users/${uid}`, "Profile not found.", "failed-precondition");
    const conversation = getDoc<{ userId: string; title: string }>(`aiConversations/${conversationId}`);
    if (conversation && conversation.userId !== uid) throw new DemoError("permission-denied", "Not your conversation.");
    const topic = topicId ? getDoc<TopicDoc>(`topics/${topicId}`) : null;
    const chapter = chapterId ? getDoc<ChapterDoc>(`chapters/${chapterId}`) : null;
    const question = questionId ? getDoc<QuestionDoc>(`questions/${questionId}`) : null;
    const key = questionId ? getDoc<QuestionKeyDoc>(`questionKeys/${questionId}`) : null;
    const weakTopics = runQuery({ path: "topicMastery", filters: [{ field: "userId", op: "==", value: uid }, { field: "strength", op: "in", value: ["weak", "needs_practice"] }], orders: [{ field: "mastery", direction: "asc" }], max: 5 }).map((row) => row.data as unknown as TopicMasteryDoc);
    const history = runQuery({ path: "aiMessages", filters: [{ field: "conversationId", op: "==", value: conversationId }], orders: [{ field: "createdAt", direction: "asc" }], max: 30 }).map((row) => row.data as unknown as AiMessageDoc);
    const explainCount = history.filter((item) => item.role === "assistant" && item.mode === "explain").length;
    const hintCount = history.filter((item) => item.role === "assistant" && item.mode === "hint").length;
    let text = fallbackResponse({ mode, topic, chapter, question, key, weakTopics, dailyGoalMinutes: user.dailyGoalMinutes, explainCount, hintCount });
    if (!text) throw new DemoError("unavailable", `${DEMO_AI_NOTICE} No authored content exists for this request yet.`);
    if (needsSupportNotice(message)) text = `${SUPPORT_NOTICE}\n\n${text}`;
    if (mode === "study_planner") {
      writeDoc(`studyPlans/${uid}`, { uid, minutesPerDay: user.dailyGoalMinutes, examDate: null, subjects: user.subjects, allocation: planMinutes(user.dailyGoalMinutes), focusTopicIds: weakTopics.map((item) => item.topicId), updatedAt: Timestamp.now() }, true);
    }
    const now = Timestamp.now();
    const userMessageId = newDocId();
    const assistantId = newDocId();
    writeDoc(`aiMessages/${userMessageId}`, { id: userMessageId, conversationId, userId: uid, role: "user", mode, text: message || mode.replace(/_/g, " "), source: null, createdAt: now });
    writeDoc(`aiMessages/${assistantId}`, { id: assistantId, conversationId, userId: uid, role: "assistant", mode, text, source: "fallback", createdAt: Timestamp.fromMillis(now.toMillis() + 1) });
    writeDoc(`aiConversations/${conversationId}`, {
      id: conversationId, userId: uid, title: conversation?.title ?? (message || topic?.name || chapter?.name || "OrbitAI chat").slice(0, 80), topicId, chapterId,
      subjectId: topic?.subjectId ?? chapter?.subjectId ?? question?.subjectId ?? null, questionId, messageCount: history.length + 2, ...(conversation ? {} : { createdAt: now }), updatedAt: now
    }, true);
    return { text, source: "fallback", notice: DEMO_AI_NOTICE, remaining: 39 };
  },

  async deleteAccount(uid) {
    const collections = ["questionAttempts", "topicMastery", "chapterProgress", "lessonProgress", "learningSessions", "assessmentAttempts", "xpTransactions", "coinTransactions", "spinHistory", "redemptions", "aiConversations", "aiMessages", "projects", "projectTasks", "reports"];
    for (const name of collections) for (const row of listDocs(name)) if (row.data.userId === uid) removeDoc(`${name}/${row.id}`);
    for (const name of ["dailyActivity", "aiUsage"]) for (const row of listDocs(name)) if (row.data.uid === uid) removeDoc(`${name}/${row.id}`);
    for (const name of ["users", "publicProfiles", "streaks", "spinState", "studyPlans", "buddyPreferences"]) removeDoc(`${name}/${uid}`);
    for (const sub of [`notifications/${uid}/items`, `userBadges/${uid}/badges`, `blocks/${uid}/users`]) for (const row of listDocs(sub)) removeDoc(`${sub}/${row.id}`);
    return { deleted: true };
  }
};

let triggersInstalled = false;

/** Mirrors the users/{uid} -> publicProfiles Cloud Function trigger and seeds streak and spin state on first write. */
export function installTriggers(): void {
  if (triggersInstalled) return;
  triggersInstalled = true;
  onWrite((path) => {
    const segments = path.split("/");
    if (segments.length !== 2 || segments[0] !== "users") return;
    const uid = segments[1];
    const user = getDoc<UserDoc>(path);
    if (!user) return;
    const existing = getDoc<PublicProfile>(`publicProfiles/${uid}`);
    const now = Timestamp.now();
    const patch: DocData = {
      uid, anonUsername: anonUsername(uid), avatar: avatarFor(uid), classLevel: user.classLevel, goal: user.goal, subjects: user.subjects ?? [], language: user.language ?? "en", learningLevel: user.learningLevel ?? "beginner",
      ...(existing ? {} : { progressSummary: { accuracy: 0, questionsSolved: 0, lessonsCompleted: 0 }, buddyStatus: "none", buddyPairId: null }),
      updatedAt: now
    };
    writeDoc(`publicProfiles/${uid}`, patch, true);
    if (!existing) {
      writeDoc(`streaks/${uid}`, { uid, current: 0, longest: 0, lastQualifiedDate: null, protectionTokens: 0, milestonesAwarded: [], updatedAt: now }, true);
      writeDoc(`spinState/${uid}`, { uid, nextSpinAt: null, lastResult: null, totalSpins: 0 }, true);
    }
  });
}
