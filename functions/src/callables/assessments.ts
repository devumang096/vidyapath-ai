import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, loadConfig, requireNumber, requireString, requireUid } from "../lib/admin.js";
import { readUserContext, serverClock, txnSink } from "../lib/engine.js";
import { PERIODIC_KINDS, periodKeyFor, startAttempt, submitAttempt } from "../lib/assessments.js";
import { istDate } from "../lib/time.js";
import { applyWrites } from "../lib/writes.js";
import { rethrow } from "./learning.js";
import type { AssessmentAttemptDoc, AssessmentDoc, QuestionDoc, QuestionKeyDoc, TopicMasteryDoc, UserDoc } from "../types.js";

const POOL_LIMIT = 300;

/** Candidate questions for a template: scoped by topic, chapter or exam tag, otherwise by the student's class and subjects. */
export async function loadPool(template: AssessmentDoc, scopeId: string | null, user: UserDoc): Promise<QuestionDoc[]> {
  const questions = db.collection("questions");
  let snapshot;
  if (template.kind === "topic_test") {
    if (!scopeId) throw new HttpsError("invalid-argument", "A topic is required.");
    snapshot = await questions.where("topicId", "==", scopeId).limit(POOL_LIMIT).get();
  } else if (template.kind === "chapter_test") {
    if (!scopeId) throw new HttpsError("invalid-argument", "A chapter is required.");
    snapshot = await questions.where("chapterId", "==", scopeId).limit(POOL_LIMIT).get();
  } else if (template.examTag) {
    snapshot = await questions.where("examTags", "array-contains", template.examTag).where("subjectId", "in", template.subjectIds).limit(POOL_LIMIT).get();
  } else {
    snapshot = await questions.where("classLevel", "==", user.classLevel).where("subjectId", "in", user.subjects.length ? user.subjects : ["physics"]).limit(POOL_LIMIT).get();
  }
  return snapshot.docs.map((doc) => doc.data() as QuestionDoc);
}

export const startAssessment = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { assessmentId?: unknown; scopeId?: unknown };
  const assessmentId = requireString(data.assessmentId, "assessmentId", 60);
  const scopeId = typeof data.scopeId === "string" && data.scopeId.length <= 120 ? data.scopeId : null;
  const [templateSnap, userSnap] = await db.getAll(db.doc(`assessments/${assessmentId}`), db.doc(`users/${uid}`));
  if (!templateSnap.exists) throw new HttpsError("not-found", "Assessment not found.");
  if (!userSnap.exists) throw new HttpsError("failed-precondition", "Profile not found.");
  const template = templateSnap.data() as AssessmentDoc;
  const user = userSnap.data() as UserDoc;
  const clock = serverClock();
  const periodKey = periodKeyFor(template.kind, istDate(clock.now));
  const attemptId = PERIODIC_KINDS.includes(template.kind) ? `${uid}_${template.id}_${periodKey}` : `${uid}_${template.id}_${db.collection("ids").doc().id}`;
  const existingSnap = PERIODIC_KINDS.includes(template.kind) ? await db.doc(`assessmentAttempts/${attemptId}`).get() : null;
  const existing = existingSnap?.exists ? (existingSnap.data() as AssessmentAttemptDoc) : null;
  const pool = existing ? [] : await loadPool(template, scopeId, user);
  try {
    const { writes, result } = startAttempt({ uid, template, scopeId, pool, existing, attemptId, clock });
    const batch = db.batch();
    applyWrites({ set: (path, doc, merge) => batch.set(db.doc(path), doc, { merge }), delete: (path) => batch.delete(db.doc(path)) }, writes);
    await batch.commit();
    return result;
  } catch (error) {
    return rethrow(error);
  }
});

export const submitAssessment = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { attemptId?: unknown; answers?: unknown; timeTakenSec?: unknown };
  const attemptId = requireString(data.attemptId, "attemptId", 160);
  const timeTakenSec = requireNumber(data.timeTakenSec ?? 0, "timeTakenSec", 0, 36_000);
  const rawAnswers = typeof data.answers === "object" && data.answers !== null ? (data.answers as Record<string, unknown>) : {};
  const config = await loadConfig();
  const attemptSnap = await db.doc(`assessmentAttempts/${attemptId}`).get();
  if (!attemptSnap.exists) throw new HttpsError("not-found", "Assessment attempt not found.");
  const attempt = attemptSnap.data() as AssessmentAttemptDoc;
  if (attempt.userId !== uid) throw new HttpsError("permission-denied", "Not your assessment.");
  const [questionSnaps, keySnaps] = await Promise.all([
    db.getAll(...attempt.questionIds.map((id) => db.doc(`questions/${id}`))),
    db.getAll(...attempt.questionIds.map((id) => db.doc(`questionKeys/${id}`)))
  ]);
  const questions = questionSnaps.filter((snap) => snap.exists).map((snap) => snap.data() as QuestionDoc);
  const keys = keySnaps.filter((snap) => snap.exists).map((snap) => snap.data() as QuestionKeyDoc);
  const topicIds = [...new Set(questions.map((question) => question.topicId))];
  const poolSizes = new Map<string, number>();
  for (const topicId of topicIds) poolSizes.set(topicId, (await db.collection("questions").where("topicId", "==", topicId).count().get()).data().count);
  return db.runTransaction(async (txn) => {
    const ctx = await readUserContext(txn, uid, `assessment_${attemptId}`, config);
    const masterySnaps = await txn.getAll(...topicIds.map((topicId) => db.doc(`topicMastery/${uid}_${topicId}`)));
    const mastery = new Map<string, TopicMasteryDoc | null>();
    masterySnaps.forEach((snap, index) => mastery.set(topicIds[index], snap.exists ? (snap.data() as TopicMasteryDoc) : null));
    try {
      const { writes, result } = submitAttempt({ ctx, clock: serverClock(ctx.now), attempt, questions, keys, rawAnswers, timeTakenSec, mastery, poolSizes });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});
