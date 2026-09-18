import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, loadConfig, requireNumber, requireString, requireUid } from "../lib/admin.js";
import { readUserContext, serverClock, txnSink } from "../lib/engine.js";
import { parseSubmittedAnswer } from "../lib/grading.js";
import { completeLesson, LogicError, recordSession, SESSION_KINDS, submitAnswer, MAX_SESSION_MINUTES_PER_CALL } from "../lib/learning.js";
import { applyWrites } from "../lib/writes.js";
import type { ChapterProgressDoc, LessonDoc, LessonProgressDoc, QuestionDoc, QuestionKeyDoc, SessionKind, TopicMasteryDoc } from "../types.js";

export function rethrow(error: unknown): never {
  if (error instanceof LogicError) throw new HttpsError(error.code, error.message);
  throw error;
}

export const startLesson = onCall(async (request) => {
  const uid = requireUid(request);
  const lessonId = requireString((request.data as { lessonId?: unknown })?.lessonId, "lessonId", 120);
  const lessonSnap = await db.doc(`lessons/${lessonId}`).get();
  if (!lessonSnap.exists) throw new HttpsError("not-found", "Lesson not found.");
  const lesson = lessonSnap.data() as LessonDoc;
  const progressRef = db.doc(`lessonProgress/${uid}_${lessonId}`);
  const existing = await progressRef.get();
  if (existing.exists) return { status: existing.get("status") };
  const clock = serverClock();
  await progressRef.set({ lessonId, userId: uid, topicId: lesson.topicId, chapterId: lesson.chapterId, subjectId: lesson.subjectId, status: "started", startedAt: clock.stamp, completedAt: null });
  return { status: "started" };
});

export const completeLessonCallable = onCall(async (request) => {
  const uid = requireUid(request);
  const lessonId = requireString((request.data as { lessonId?: unknown })?.lessonId, "lessonId", 120);
  const config = await loadConfig();
  const lessonSnap = await db.doc(`lessons/${lessonId}`).get();
  if (!lessonSnap.exists) throw new HttpsError("not-found", "Lesson not found.");
  const lesson = lessonSnap.data() as LessonDoc;
  const lessonsInChapter = (await db.collection("lessons").where("chapterId", "==", lesson.chapterId).count().get()).data().count;
  return db.runTransaction(async (txn) => {
    const ctx = await readUserContext(txn, uid, `lesson_${uid}_${lessonId}`, config);
    const [progressSnap, chapterSnap] = await txn.getAll(db.doc(`lessonProgress/${uid}_${lessonId}`), db.doc(`chapterProgress/${uid}_${lesson.chapterId}`));
    const { writes, result } = completeLesson({
      ctx,
      clock: serverClock(ctx.now),
      lesson,
      progress: progressSnap.exists ? (progressSnap.data() as LessonProgressDoc) : null,
      chapterProgress: chapterSnap.exists ? (chapterSnap.data() as ChapterProgressDoc) : null,
      lessonsInChapter
    });
    applyWrites(txnSink(txn), writes);
    return result;
  });
});

export const submitAnswerCallable = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { attemptId?: unknown; questionId?: unknown; answer?: unknown; timeTakenSec?: unknown; context?: unknown };
  const attemptId = requireString(data.attemptId, "attemptId", 80);
  const questionId = requireString(data.questionId, "questionId", 120);
  const context = data.context === "topic" ? "topic" : "practice";
  const timeTakenSec = requireNumber(data.timeTakenSec ?? 0, "timeTakenSec", 0, 36_000);
  const config = await loadConfig();
  const [questionSnap, keySnap] = await db.getAll(db.doc(`questions/${questionId}`), db.doc(`questionKeys/${questionId}`));
  if (!questionSnap.exists || !keySnap.exists) throw new HttpsError("not-found", "Question not found.");
  const question = questionSnap.data() as QuestionDoc;
  const key = keySnap.data() as QuestionKeyDoc;
  const answer = parseSubmittedAnswer(data.answer, question.type, question.options.length);
  if (!answer) throw new HttpsError("invalid-argument", "Invalid answer.");
  const poolSize = (await db.collection("questions").where("topicId", "==", question.topicId).count().get()).data().count;
  return db.runTransaction(async (txn) => {
    const ctx = await readUserContext(txn, uid, `answer_${uid}_${attemptId}`, config);
    const [masterySnap, priorSnap] = await Promise.all([
      txn.get(db.doc(`topicMastery/${uid}_${question.topicId}`)),
      txn.get(db.collection("questionAttempts").where("userId", "==", uid).where("questionId", "==", questionId))
    ]);
    try {
      const { writes, result } = submitAnswer({
        ctx,
        clock: serverClock(ctx.now),
        attemptId,
        question,
        key,
        answer,
        timeTakenSec,
        context,
        mastery: masterySnap.exists ? (masterySnap.data() as TopicMasteryDoc) : null,
        priorAttempts: priorSnap.size,
        solvedBefore: priorSnap.docs.some((doc) => doc.get("correct") === true),
        poolSize
      });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});

export const recordStudySession = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { sessionId?: unknown; topicId?: unknown; minutes?: unknown; kind?: unknown };
  const sessionId = requireString(data.sessionId, "sessionId", 80);
  const minutes = requireNumber(data.minutes, "minutes", 1, MAX_SESSION_MINUTES_PER_CALL);
  const kind = requireString(data.kind, "kind", 20) as SessionKind;
  if (!SESSION_KINDS.includes(kind)) throw new HttpsError("invalid-argument", "Invalid session kind.");
  const topicId = typeof data.topicId === "string" && data.topicId.length <= 120 ? data.topicId : null;
  const config = await loadConfig();
  return db.runTransaction(async (txn) => {
    const ctx = await readUserContext(txn, uid, `session_${uid}_${sessionId}`, config);
    const { writes, result } = recordSession({ ctx, clock: serverClock(ctx.now), sessionId, topicId, minutes, kind });
    applyWrites(txnSink(txn), writes);
    return result;
  });
});
