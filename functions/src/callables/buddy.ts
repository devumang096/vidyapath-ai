import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, loadConfig, requireNumber, requireString, requireUid } from "../lib/admin.js";
import { readUserContext, serverClock, txnSink, type OutcomeContext } from "../lib/engine.js";
import { cancelRequest, countActivity, createChallenge, rankCandidates, refreshChallenge, respondRequest, roomAction, sendRequest, sessionDoc, unmatch, type RoomAction } from "../lib/buddy.js";
import { toMillis } from "../lib/outcome.js";
import { applyWrites } from "../lib/writes.js";
import { rethrow } from "./learning.js";
import type { BuddyChallengeDoc, BuddyPairDoc, BuddyPreferencesDoc, BuddyRequestDoc, BuddySessionDoc, ChallengeKind, PublicProfile, UserDoc } from "../types.js";

async function blockedEitherWay(uid: string, other: string): Promise<boolean> {
  const [mine, theirs] = await db.getAll(db.doc(`blocks/${uid}/users/${other}`), db.doc(`blocks/${other}/users/${uid}`));
  return mine.exists || theirs.exists;
}

async function activePair(uid: string): Promise<BuddyPairDoc | null> {
  const snap = await db.collection("buddies").where("members", "array-contains", uid).where("status", "==", "active").limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as BuddyPairDoc);
}

function batchSink() {
  const batch = db.batch();
  return { batch, sink: { set: (path: string, data: Record<string, unknown>, merge: boolean) => batch.set(db.doc(path), data, { merge }), delete: (path: string) => batch.delete(db.doc(path)) } };
}

export const findBuddyCandidates = onCall(async (request) => {
  const uid = requireUid(request);
  const [meSnap, prefsSnap, blocksSnap] = await Promise.all([db.doc(`publicProfiles/${uid}`).get(), db.doc(`buddyPreferences/${uid}`).get(), db.collection(`blocks/${uid}/users`).get()]);
  if (!meSnap.exists) throw new HttpsError("failed-precondition", "Profile not found.");
  const me = { profile: meSnap.data() as PublicProfile, prefs: prefsSnap.exists ? (prefsSnap.data() as BuddyPreferencesDoc) : null };
  const openSnap = await db.collection("buddyPreferences").where("open", "==", true).limit(200).get();
  const openUids = openSnap.docs.map((doc) => doc.id).filter((other) => other !== uid);
  if (openUids.length === 0) return { candidates: [] };
  const profileSnaps = await db.getAll(...openUids.map((other) => db.doc(`publicProfiles/${other}`)));
  const blockedBy = await Promise.all(openUids.map((other) => db.doc(`blocks/${other}/users/${uid}`).get()));
  const blocked = new Set<string>([...blocksSnap.docs.map((doc) => doc.id), ...openUids.filter((_, index) => blockedBy[index].exists)]);
  const candidates = profileSnaps.filter((snap) => snap.exists).map((snap, index) => ({ profile: snap.data() as PublicProfile, prefs: openSnap.docs[index]?.data() as BuddyPreferencesDoc }));
  return { candidates: rankCandidates(me, candidates, blocked) };
});

export const sendBuddyRequest = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { toUid?: unknown; message?: unknown };
  const toUid = requireString(data.toUid, "toUid", 128);
  const message = typeof data.message === "string" ? data.message : "";
  const [fromSnap, toSnap, toPrefsSnap, userSnap] = await db.getAll(db.doc(`publicProfiles/${uid}`), db.doc(`publicProfiles/${toUid}`), db.doc(`buddyPreferences/${toUid}`), db.doc(`users/${toUid}`));
  if (!fromSnap.exists || !toSnap.exists) throw new HttpsError("not-found", "Student not found.");
  const between = await db.collection("buddyRequests").where("fromUid", "in", [uid, toUid]).where("status", "==", "pending").get();
  const existing = between.docs.map((doc) => doc.data() as BuddyRequestDoc).find((row) => (row.fromUid === uid && row.toUid === toUid) || (row.fromUid === toUid && row.toUid === uid)) ?? null;
  const requestId = db.collection("buddyRequests").doc().id;
  try {
    const { writes, result } = sendRequest({
      fromUid: uid, toUid, message, requestId, blockedEitherWay: await blockedEitherWay(uid, toUid),
      fromProfile: fromSnap.data() as PublicProfile, toProfile: toSnap.data() as PublicProfile, toPrefsOpen: toPrefsSnap.exists && toPrefsSnap.get("open") === true,
      existingBetween: existing, recipientNotify: (userSnap.data() as UserDoc | undefined)?.notificationPrefs?.buddy !== false, clock: serverClock()
    });
    const { batch, sink } = batchSink();
    applyWrites(sink, writes);
    await batch.commit();
    return result;
  } catch (error) {
    return rethrow(error);
  }
});

export const respondBuddyRequest = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { requestId?: unknown; accept?: unknown };
  const requestId = requireString(data.requestId, "requestId", 80);
  const accept = data.accept === true;
  return db.runTransaction(async (txn) => {
    const requestSnap = await txn.get(db.doc(`buddyRequests/${requestId}`));
    if (!requestSnap.exists) throw new HttpsError("not-found", "Request not found.");
    const buddyRequest = requestSnap.data() as BuddyRequestDoc;
    const [fromSnap, toSnap] = await txn.getAll(db.doc(`publicProfiles/${buddyRequest.fromUid}`), db.doc(`publicProfiles/${buddyRequest.toUid}`));
    try {
      const { writes, result } = respondRequest({ uid, request: buddyRequest, accept, fromProfile: fromSnap.data() as PublicProfile, toProfile: toSnap.data() as PublicProfile, pairId: db.collection("buddies").doc().id, clock: serverClock() });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});

export const cancelBuddyRequest = onCall(async (request) => {
  const uid = requireUid(request);
  const requestId = requireString((request.data as { requestId?: unknown })?.requestId, "requestId", 80);
  const snap = await db.doc(`buddyRequests/${requestId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Request not found.");
  try {
    const { batch, sink } = batchSink();
    applyWrites(sink, cancelRequest(uid, snap.data() as BuddyRequestDoc, serverClock()));
    await batch.commit();
    return { cancelled: true };
  } catch (error) {
    return rethrow(error);
  }
});

export const unmatchBuddy = onCall(async (request) => {
  const uid = requireUid(request);
  const pair = await activePair(uid);
  try {
    const { batch, sink } = batchSink();
    applyWrites(sink, unmatch(uid, pair, serverClock()));
    await batch.commit();
    return { ended: true };
  } catch (error) {
    return rethrow(error);
  }
});

const ROOM_ACTIONS = new Set<RoomAction>(["join", "leave", "start", "pause", "resume", "stop", "reset"]);

export const buddyRoomAction = onCall(async (request) => {
  const uid = requireUid(request);
  const action = requireString((request.data as { action?: unknown })?.action, "action", 10) as RoomAction;
  if (!ROOM_ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Unknown room action.");
  const pair = await activePair(uid);
  if (!pair) throw new HttpsError("failed-precondition", "You do not have a Buddy yet.");
  const config = await loadConfig();
  const historyId = `${pair.id}_${db.collection("ids").doc().id}`;
  return db.runTransaction(async (txn) => {
    const sessionSnap = await txn.get(db.doc(`buddySessions/${pair.id}_live`));
    const session = sessionDoc(sessionSnap.exists ? (sessionSnap.data() as BuddySessionDoc) : null, pair.id, pair.members);
    const contexts = new Map<string, OutcomeContext>();
    if (action === "stop") for (const member of pair.members) contexts.set(member, await readUserContext(txn, member, `session_${member}_buddy-${historyId}`, config));
    try {
      const { writes, result } = roomAction({ uid, pair, session, action, contexts, historyId, clock: serverClock() });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});

export const createBuddyChallenge = onCall(async (request) => {
  const uid = requireUid(request);
  const data = (request.data ?? {}) as { kind?: unknown; target?: unknown; days?: unknown };
  const kind = requireString(data.kind, "kind", 20) as ChallengeKind;
  const target = requireNumber(data.target, "target", 1, 10_000);
  const days = requireNumber(data.days ?? 7, "days", 1, 30);
  const pair = await activePair(uid);
  try {
    const { writes, result } = createChallenge({ uid, pair, kind, target, days, challengeId: db.collection("buddyChallenges").doc().id, clock: serverClock() });
    const { batch, sink } = batchSink();
    applyWrites(sink, writes);
    await batch.commit();
    return result;
  } catch (error) {
    return rethrow(error);
  }
});

export async function activitySince(uid: string, sinceMs: number, kind: ChallengeKind): Promise<number> {
  const since = new Date(sinceMs);
  const docs = { learningSessions: [] as { minutes: number; createdAt: unknown }[], questionAttempts: [] as { correct: boolean; createdAt: unknown }[], chapterProgress: [] as { completed: boolean; completedAt: unknown }[], assessmentAttempts: [] as { finalized: boolean; finalizedAt: unknown }[] };
  if (kind === "study_minutes") docs.learningSessions = (await db.collection("learningSessions").where("userId", "==", uid).where("createdAt", ">=", since).get()).docs.map((doc) => doc.data() as never);
  if (kind === "questions") docs.questionAttempts = (await db.collection("questionAttempts").where("userId", "==", uid).where("createdAt", ">=", since).get()).docs.map((doc) => doc.data() as never);
  if (kind === "chapter") docs.chapterProgress = (await db.collection("chapterProgress").where("userId", "==", uid).where("completed", "==", true).get()).docs.map((doc) => doc.data() as never);
  if (kind === "assessment") docs.assessmentAttempts = (await db.collection("assessmentAttempts").where("userId", "==", uid).where("finalized", "==", true).get()).docs.map((doc) => doc.data() as never);
  return countActivity(kind, docs, sinceMs);
}

export const refreshBuddyChallenge = onCall(async (request) => {
  const uid = requireUid(request);
  const challengeId = requireString((request.data as { challengeId?: unknown })?.challengeId, "challengeId", 80);
  const snap = await db.doc(`buddyChallenges/${challengeId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Challenge not found.");
  const challenge = snap.data() as BuddyChallengeDoc;
  if (!challenge.members.includes(uid)) throw new HttpsError("permission-denied", "You are not in this challenge.");
  const sinceMs = toMillis(challenge.startsAt) ?? 0;
  const counts: Record<string, number> = {};
  for (const member of challenge.members) counts[member] = await activitySince(member, sinceMs, challenge.kind);
  const config = await loadConfig();
  return db.runTransaction(async (txn) => {
    const contexts = new Map<string, OutcomeContext>();
    for (const member of challenge.members) contexts.set(member, await readUserContext(txn, member, `challenge_${challenge.id}_${member}`, config));
    try {
      const { writes, result } = refreshChallenge({ uid, challenge, counts, contexts, clock: serverClock() });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});
