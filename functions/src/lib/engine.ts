import { Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin.js";
import { istDate } from "./time.js";
import { applyWrites, type Clock } from "./writes.js";
import { computeOutcome, normalizeActivity, normalizeStreak, normalizeUser, notificationOp, type Outcome, type OutcomeContext, type OutcomeResult, type UserServerFields } from "./outcome.js";
import type { DailyActivityDoc, NotificationPrefs, RewardConfig, StreakDoc } from "../types.js";

export type { Outcome, OutcomeContext, OutcomeResult, UserServerFields } from "./outcome.js";
export { computeOutcome, toMillis } from "./outcome.js";

export interface UserContext extends OutcomeContext {
  now: Date;
  today: string;
  userRef: DocumentReference;
  streakRef: DocumentReference;
  activityRef: DocumentReference;
  eventRef: DocumentReference;
}

/**
 * All reads a value-awarding callable needs, done up front so the transaction
 * can then write. Every awarding function calls this once, then applyOutcome once.
 */
export async function readUserContext(txn: Transaction, uid: string, eventId: string, config: RewardConfig, now = new Date()): Promise<UserContext> {
  const today = istDate(now);
  const userRef = db.doc(`users/${uid}`);
  const streakRef = db.doc(`streaks/${uid}`);
  const activityRef = db.doc(`dailyActivity/${uid}_${today}`);
  const eventRef = db.doc(`processedEvents/${eventId}`);
  const [userSnap, streakSnap, activitySnap, eventSnap] = await txn.getAll(userRef, streakRef, activityRef, eventRef);
  if (!userSnap.exists) throw new HttpsError("failed-precondition", "Profile not found. Complete registration first.");
  return {
    uid,
    now,
    today,
    config,
    userRef,
    user: normalizeUser(uid, userSnap.data() as Partial<UserServerFields>),
    streakRef,
    streak: normalizeStreak((streakSnap.data() ?? {}) as Partial<StreakDoc>),
    activityRef,
    activity: normalizeActivity((activitySnap.data() ?? {}) as Partial<DailyActivityDoc>),
    eventRef,
    eventDone: eventSnap.exists
  };
}

export function serverClock(now = new Date()): Clock {
  return { now, today: istDate(now), stamp: Timestamp.fromDate(now), newId: () => db.collection("ids").doc().id };
}

export function txnSink(txn: Transaction) {
  return {
    set: (path: string, data: Record<string, unknown>, merge: boolean) => {
      if (merge) txn.set(db.doc(path), data, { merge: true });
      else txn.set(db.doc(path), data);
    },
    delete: (path: string) => txn.delete(db.doc(path))
  };
}

/** Transactional wrapper around computeOutcome for Cloud Functions. */
export function applyOutcome(txn: Transaction, ctx: UserContext, outcome: Outcome): OutcomeResult {
  const clock = serverClock(ctx.now);
  const { writes, result } = computeOutcome(ctx, outcome, clock);
  applyWrites(txnSink(txn), writes);
  return result;
}

export function addNotification(txn: Transaction, uid: string, prefs: NotificationPrefs, type: keyof NotificationPrefs | "system", title: string, body: string, link: string | null): void {
  const op = notificationOp(uid, prefs, type, title, body, link, serverClock());
  if (op) applyWrites(txnSink(txn), [op]);
}

