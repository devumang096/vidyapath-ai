import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { GoogleGenAI } from "@google/genai";
import { db, loadConfig, requireString, requireUid } from "../lib/admin.js";
import { istDate } from "../lib/time.js";
import { leaksFinalAnswer, needsSupportNotice, SUPPORT_NOTICE, validateAiText } from "../lib/aiValidate.js";
import { FALLBACK_NOTICE, fallbackResponse, planMinutes } from "../lib/aiFallback.js";
import { GOAL_LABELS, type AiMessageDoc, type AiMode, type ChapterDoc, type QuestionDoc, type QuestionKeyDoc, type TopicDoc, type TopicMasteryDoc, type UserDoc } from "../types.js";

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 20_000;
export const AI_MODES: readonly AiMode[] = ["explain", "solve", "hint", "quiz", "revision", "mistake_analysis", "study_planner"];

export interface AskAiInput {
  conversationId?: unknown;
  mode?: unknown;
  message?: unknown;
  beginner?: unknown;
  topicId?: unknown;
  chapterId?: unknown;
  questionId?: unknown;
  attemptAnswer?: unknown;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AI request timed out")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export interface PromptContext {
  user: UserDoc;
  topic: TopicDoc | null;
  chapter: ChapterDoc | null;
  question: QuestionDoc | null;
  key: QuestionKeyDoc | null;
  weakTopics: TopicMasteryDoc[];
  history: AiMessageDoc[];
  explainCount: number;
  hintCount: number;
  beginner: boolean;
  mode: AiMode;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const { user, topic, chapter, question, key } = ctx;
  const lines = [
    "You are OrbitAI, the patient study tutor inside EduOrbit, for Indian students in Classes 9 to 12 and JEE or NEET aspirants.",
    `Student: Class ${user.classLevel}, goal ${GOAL_LABELS[user.goal] ?? user.goal}, level ${user.learningLevel}, preferred language ${user.language === "hi" ? "Hindi (reply in simple Hinglish if asked)" : "English"}.`,
    "Only Physics, Chemistry, Mathematics and Biology exist on this platform. Politely redirect anything else back to study.",
    "Use simple language, short paragraphs and SI units. Keep answers under 300 words. Never include links, code or anything unrelated to school study. Content must be appropriate for minors.",
    "Do not reproduce copyrighted textbook text. Explain in your own words.",
    "You are not a counsellor. If the student shares distress, respond with care in one or two sentences, point them to a trusted adult, and return to study help."
  ];
  if (chapter) lines.push(`Chapter: ${chapter.name} (Class ${chapter.classLevel}, ${chapter.subjectId}).`);
  if (topic) lines.push(`Topic: ${topic.name}. Key points: ${topic.keyPoints.join("; ")}. Formulae: ${topic.formulae.join("; ")}. Common mistakes: ${topic.commonMistakes.join("; ")}.`);
  if (question) lines.push(`Current question: ${question.text}${question.options.length ? ` Options: ${question.options.map((option, index) => `(${index + 1}) ${option}`).join(" ")}` : ""}.`);
  if (key && ctx.mode !== "hint") lines.push(`Answer key (for your reference): ${key.numericAnswer ?? key.correctIndexes.map((index) => index + 1).join(", ")}. Explanation: ${key.explanation}`);
  if (ctx.mode === "hint") lines.push("HINT MODE: never state the final answer or the correct option. Give exactly one next step and end with a question back to the student.");
  if (ctx.weakTopics.length) lines.push(`Weak topics from real performance: ${ctx.weakTopics.map((item) => `${item.topicId} (mastery ${item.mastery})`).join(", ")}.`);
  if (ctx.beginner) lines.push("BEGINNER MODE: assume no prior knowledge, define every term, use one everyday analogy, avoid jargon.");
  if (ctx.mode === "explain" && ctx.explainCount > 0) {
    lines.push(`This concept has already been explained ${ctx.explainCount} time(s) in this conversation. Use a different approach this time: ${["a concrete example first", "an everyday analogy", "step-by-step reasoning from first principles", "a short practice question with a worked answer"][ctx.explainCount % 4]}.`);
  }
  if (ctx.mode === "study_planner") {
    const plan = planMinutes(user.dailyGoalMinutes);
    lines.push(`Build a daily plan for ${user.dailyGoalMinutes} minutes. Suggested split: learn ${plan.learning}, practice ${plan.practice}, revision ${plan.revision}, assessment ${plan.assessment}, OrbitAI ${plan.ai}, breaks ${plan.breaks}. Prioritise the weak topics.`);
  }
  return lines.join("\n");
}

export function buildUserPrompt(mode: AiMode, message: string, attemptAnswer: string): string {
  const prompts: Record<AiMode, string> = {
    explain: "Explain this concept clearly with one example.",
    solve: "Solve this step by step, naming the concept used at each step.",
    hint: "Give one hint for the next step only.",
    quiz: "Ask me one exam-style question on this topic, then evaluate my reply strictly when I answer.",
    revision: "Give a compact revision sheet: concept, formulae, common mistakes, one quick question.",
    mistake_analysis: attemptAnswer ? `My answer was "${attemptAnswer}". Find the mistake, classify it (concept, formula, calculation, unit, sign, misread, reasoning) and show the correct approach.` : "Analyse the mistakes I usually make in this topic and how to avoid them.",
    study_planner: "Create my personalised study plan for today."
  };
  return message ? `${prompts[mode]}\n\nStudent says: ${message}` : prompts[mode];
}

/**
 * Single AI entry point. Keys stay in a Functions secret, usage is capped per day, output is
 * validated, conversations persist server-side and a content-authored fallback answers when the
 * model is unavailable.
 */
export const askAi = onCall({ secrets: [geminiApiKey], timeoutSeconds: 60 }, async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as AskAiInput;
  const conversationId = requireString(data.conversationId, "conversationId", 80);
  const mode = requireString(data.mode, "mode", 30) as AiMode;
  if (!AI_MODES.includes(mode)) throw new HttpsError("invalid-argument", "Unknown mode.");
  const message = typeof data.message === "string" ? data.message.slice(0, 1500).trim() : "";
  const beginner = data.beginner === true;
  const topicId = typeof data.topicId === "string" ? data.topicId.slice(0, 120) : null;
  const chapterId = typeof data.chapterId === "string" ? data.chapterId.slice(0, 120) : null;
  const questionId = typeof data.questionId === "string" ? data.questionId.slice(0, 120) : null;
  const attemptAnswer = typeof data.attemptAnswer === "string" ? data.attemptAnswer.slice(0, 200) : "";
  const config = await loadConfig();
  const today = istDate(new Date());

  const usageRef = db.doc(`aiUsage/${uid}_${today}`);
  const remaining = await db.runTransaction(async (txn) => {
    const snap = await txn.get(usageRef);
    const count = (snap.get("count") as number | undefined) ?? 0;
    if (count >= config.aiDailyLimit) {
      throw new HttpsError("resource-exhausted", `Daily OrbitAI limit of ${config.aiDailyLimit} reached. It resets at midnight IST.`);
    }
    txn.set(usageRef, { uid, date: today, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return config.aiDailyLimit - count - 1;
  });

  const conversationRef = db.doc(`aiConversations/${conversationId}`);
  const [userSnap, conversationSnap, topicSnap, chapterSnap, questionSnap, keySnap, weakSnap, historySnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    conversationRef.get(),
    topicId ? db.doc(`topics/${topicId}`).get() : Promise.resolve(null),
    chapterId ? db.doc(`chapters/${chapterId}`).get() : Promise.resolve(null),
    questionId ? db.doc(`questions/${questionId}`).get() : Promise.resolve(null),
    questionId ? db.doc(`questionKeys/${questionId}`).get() : Promise.resolve(null),
    db.collection("topicMastery").where("userId", "==", uid).where("strength", "in", ["weak", "needs_practice"]).orderBy("mastery", "asc").limit(5).get(),
    db.collection("aiMessages").where("conversationId", "==", conversationId).orderBy("createdAt", "asc").limit(30).get()
  ]);
  if (!userSnap.exists) throw new HttpsError("failed-precondition", "Profile not found.");
  if (conversationSnap.exists && conversationSnap.get("userId") !== uid) throw new HttpsError("permission-denied", "Not your conversation.");
  const user = userSnap.data() as UserDoc;
  const topic = topicSnap?.exists ? (topicSnap.data() as TopicDoc) : null;
  const chapter = chapterSnap?.exists ? (chapterSnap.data() as ChapterDoc) : null;
  const question = questionSnap?.exists ? (questionSnap.data() as QuestionDoc) : null;
  const key = keySnap?.exists ? (keySnap.data() as QuestionKeyDoc) : null;
  const weakTopics = weakSnap.docs.map((doc) => doc.data() as TopicMasteryDoc);
  const history = historySnap.docs.map((doc) => doc.data() as AiMessageDoc);
  const explainCount = history.filter((item) => item.role === "assistant" && item.mode === "explain").length;
  const hintCount = history.filter((item) => item.role === "assistant" && item.mode === "hint").length;
  const promptContext: PromptContext = { user, topic, chapter, question, key, weakTopics, history, explainCount, hintCount, beginner, mode };

  let text: string | null = null;
  let source: "gemini" | "fallback" = "fallback";
  let notice: string | null = null;
  const apiKey = geminiApiKey.value();
  if (apiKey) {
    try {
      const client = new GoogleGenAI({ apiKey });
      const contents = [
        ...history.slice(-10).map((item) => ({ role: item.role === "user" ? "user" : "model", parts: [{ text: item.text }] })),
        { role: "user", parts: [{ text: buildUserPrompt(mode, message, attemptAnswer) }] }
      ];
      const response = await withTimeout(
        client.models.generateContent({ model: MODEL, contents, config: { systemInstruction: buildSystemPrompt(promptContext), maxOutputTokens: 800, temperature: 0.5 } }),
        TIMEOUT_MS
      );
      const validated = validateAiText(response.text);
      const answerStrings = key ? [...(key.numericAnswer !== null ? [String(key.numericAnswer)] : []), ...key.correctIndexes.map((index) => question?.options[index] ?? "")] : [];
      if (!validated.ok) {
        logger.warn("AI response rejected", { uid, mode, reason: validated.reason });
      } else if (mode === "hint" && key && leaksFinalAnswer(validated.text, answerStrings)) {
        logger.warn("AI response leaked the answer in hint mode", { uid, mode });
      } else {
        text = validated.text;
        source = "gemini";
      }
    } catch (error) {
      logger.error("Gemini call failed", { uid, mode, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!text) {
    text = fallbackResponse({ mode, topic, chapter, question, key, weakTopics, dailyGoalMinutes: user.dailyGoalMinutes, explainCount, hintCount });
    notice = apiKey ? FALLBACK_NOTICE : "OrbitAI is not connected to an AI key yet. Showing the content-authored explanation instead.";
    if (!text) throw new HttpsError("unavailable", `${notice} No authored content exists for this request yet.`);
  }
  if (needsSupportNotice(message)) text = `${SUPPORT_NOTICE}\n\n${text}`;

  if (mode === "study_planner") {
    const plan = planMinutes(user.dailyGoalMinutes);
    await db.doc(`studyPlans/${uid}`).set(
      { uid, minutesPerDay: user.dailyGoalMinutes, examDate: null, subjects: user.subjects, allocation: plan, focusTopicIds: weakTopics.map((item) => item.topicId), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  const batch = db.batch();
  const userMessageRef = db.collection("aiMessages").doc();
  const assistantRef = db.collection("aiMessages").doc();
  const now = FieldValue.serverTimestamp();
  batch.set(userMessageRef, { id: userMessageRef.id, conversationId, userId: uid, role: "user", mode, text: message || buildUserPrompt(mode, "", attemptAnswer), source: null, createdAt: now });
  batch.set(assistantRef, { id: assistantRef.id, conversationId, userId: uid, role: "assistant", mode, text, source, createdAt: now });
  batch.set(
    conversationRef,
    {
      id: conversationId,
      userId: uid,
      title: conversationSnap.exists ? conversationSnap.get("title") : (message || topic?.name || chapter?.name || "OrbitAI chat").slice(0, 80),
      topicId,
      chapterId,
      subjectId: topic?.subjectId ?? chapter?.subjectId ?? question?.subjectId ?? null,
      questionId,
      messageCount: history.length + 2,
      ...(conversationSnap.exists ? {} : { createdAt: now }),
      updatedAt: now
    },
    { merge: true }
  );
  await batch.commit();

  return { text, source, notice, remaining };
});
