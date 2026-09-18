import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { db, loadConfig, requireNumber, requireString, requireUid } from "../lib/admin.js";
import { readUserContext, serverClock, txnSink, type OutcomeContext } from "../lib/engine.js";
import * as groups from "../lib/groups.js";
import { inviteCode } from "../lib/hash.js";
import { applyRoomAction, ROOM_ACTIONS, stopEventId, type RoomAction } from "../lib/room.js";
import { toMillis } from "../lib/outcome.js";
import { applyWrites, type WriteOp } from "../lib/writes.js";
import { activitySince } from "./buddy.js";
import { rethrow } from "./learning.js";
import type { ChallengeKind, GroupChallengeDoc, GroupDoc, GroupInvitationDoc, GroupInviteCodeDoc, GroupJoinRequestDoc, GroupMemberDoc, GroupPostDoc, GroupPostReactionDoc, GroupReplyDoc, GroupRole, GroupSessionDoc, PublicProfile, ReportReason } from "../types.js";

type Data = Record<string, unknown>;

async function context(uid: string, groupId: string): Promise<{ group: GroupDoc | null; member: GroupMemberDoc | null }> {
  const [groupSnap, memberSnap] = await db.getAll(db.doc(`groups/${groupId}`), db.doc(`groupMembers/${groupId}_${uid}`));
  return { group: groupSnap.exists ? (groupSnap.data() as GroupDoc) : null, member: memberSnap.exists ? (memberSnap.data() as GroupMemberDoc) : null };
}

async function commit(writes: WriteOp[]): Promise<void> {
  const batch = db.batch();
  applyWrites({ set: (path, doc, merge) => batch.set(db.doc(path), doc, { merge }), delete: (path) => batch.delete(db.doc(path)) }, writes);
  await batch.commit();
}

async function profileOf(uid: string): Promise<PublicProfile> {
  const snap = await db.doc(`publicProfiles/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Profile not found.");
  return snap.data() as PublicProfile;
}

async function optional<T>(path: string): Promise<T | null> {
  const snap = await db.doc(path).get();
  return snap.exists ? (snap.data() as T) : null;
}

function data(request: CallableRequest<unknown>): Data {
  return (request.data ?? {}) as Data;
}

function guard<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error) => rethrow(error));
}

export const createGroup = onCall(async (request) => {
  const uid = requireUid(request);
  return guard(async () => {
    const fields = groups.validateGroupInput(data(request));
    const { writes, result } = groups.createGroup({ uid, profile: await profileOf(uid), groupId: db.collection("groups").doc().id, fields, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const updateGroup = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    const fields = groups.validateGroupInput(body);
    const resources = Array.isArray(body.resources) ? (body.resources as { title: string; url: string }[]) : null;
    await commit(groups.updateGroup({ uid, ...(await context(uid, groupId)), fields, resources, clock: serverClock() }));
    return { updated: true };
  });
});

export const requestJoinGroup = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    const pendingSnap = await db.collection("groupJoinRequests").where("groupId", "==", groupId).where("uid", "==", uid).where("status", "==", "pending").limit(1).get();
    const { writes, result } = groups.requestJoin({ uid, ...(await context(uid, groupId)), pending: pendingSnap.empty ? null : (pendingSnap.docs[0].data() as GroupJoinRequestDoc), message: typeof body.message === "string" ? body.message : "", requestId: db.collection("groupJoinRequests").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const respondJoinRequest = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const requestId = requireString(body.requestId, "requestId", 80);
  return guard(async () => {
    const joinRequest = await optional<GroupJoinRequestDoc>(`groupJoinRequests/${requestId}`);
    if (!joinRequest) throw new HttpsError("not-found", "Request not found.");
    const ctx = await context(uid, joinRequest.groupId);
    const [requesterProfile, requesterMember] = await Promise.all([optional<PublicProfile>(`publicProfiles/${joinRequest.uid}`), optional<GroupMemberDoc>(`groupMembers/${joinRequest.groupId}_${joinRequest.uid}`)]);
    const { writes, result } = groups.respondJoinRequest({ uid, ...ctx, request: joinRequest, approve: body.approve === true, requesterProfile, requesterMember, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const createGroupInviteCode = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    let code = inviteCode();
    while ((await db.doc(`groupInviteCodes/${code}`).get()).exists) code = inviteCode();
    const { writes, result } = groups.createInviteCode({ uid, ...(await context(uid, groupId)), code, expiresInHours: requireNumber(body.expiresInHours ?? 72, "expiresInHours", 1, 720), maxUses: requireNumber(body.maxUses ?? 10, "maxUses", 1, 100), clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const revokeGroupInviteCode = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const code = requireString(body.code, "code", 12).toUpperCase();
  return guard(async () => {
    const codeDoc = await optional<GroupInviteCodeDoc>(`groupInviteCodes/${code}`);
    if (!codeDoc) throw new HttpsError("not-found", "Code not found.");
    await commit(groups.revokeInviteCode({ uid, ...(await context(uid, codeDoc.groupId)), code: codeDoc, clock: serverClock() }));
    return { revoked: true };
  });
});

export const joinGroupWithCode = onCall(async (request) => {
  const uid = requireUid(request);
  const code = requireString(data(request).code, "code", 12).toUpperCase().trim();
  return guard(async () => {
    const codeDoc = await optional<GroupInviteCodeDoc>(`groupInviteCodes/${code}`);
    const ctx = codeDoc ? await context(uid, codeDoc.groupId) : { group: null, member: null };
    const { writes, result } = groups.joinWithCode({ uid, profile: await profileOf(uid), code: codeDoc, ...ctx, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const inviteToGroup = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  const anonUsername = requireString(body.anonUsername, "anonUsername", 40);
  return guard(async () => {
    const profileSnap = await db.collection("publicProfiles").where("anonUsername", "==", anonUsername).limit(1).get();
    const toProfile = profileSnap.empty ? null : (profileSnap.docs[0].data() as PublicProfile);
    const [toMember, pendingSnap] = await Promise.all([
      toProfile ? optional<GroupMemberDoc>(`groupMembers/${groupId}_${toProfile.uid}`) : Promise.resolve(null),
      toProfile ? db.collection("groupInvitations").where("groupId", "==", groupId).where("toUid", "==", toProfile.uid).where("status", "==", "pending").limit(1).get() : Promise.resolve(null)
    ]);
    const { writes, result } = groups.invite({ uid, ...(await context(uid, groupId)), toProfile, toMember, pending: pendingSnap && !pendingSnap.empty ? (pendingSnap.docs[0].data() as GroupInvitationDoc) : null, invitationId: db.collection("groupInvitations").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const respondGroupInvitation = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const invitationId = requireString(body.invitationId, "invitationId", 80);
  return guard(async () => {
    const invitation = await optional<GroupInvitationDoc>(`groupInvitations/${invitationId}`);
    if (!invitation) throw new HttpsError("not-found", "Invitation not found.");
    const { writes, result } = groups.respondInvitation({ uid, profile: await profileOf(uid), invitation, accept: body.accept === true, ...(await context(uid, invitation.groupId)), clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const leaveGroup = onCall(async (request) => {
  const uid = requireUid(request);
  const groupId = requireString(data(request).groupId, "groupId", 80);
  return guard(async () => {
    const othersSnap = await db.collection("groupMembers").where("groupId", "==", groupId).get();
    const others = othersSnap.docs.map((doc) => doc.data() as GroupMemberDoc).filter((member) => member.uid !== uid);
    const { writes, result } = groups.leaveGroup({ uid, ...(await context(uid, groupId)), others, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const removeGroupMember = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  const targetUid = requireString(body.targetUid, "targetUid", 128);
  return guard(async () => {
    await commit(groups.removeMember({ uid, ...(await context(uid, groupId)), target: await optional<GroupMemberDoc>(`groupMembers/${groupId}_${targetUid}`), clock: serverClock() }));
    return { removed: true };
  });
});

export const setGroupRole = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  const targetUid = requireString(body.targetUid, "targetUid", 128);
  const role = requireString(body.role, "role", 10) as GroupRole;
  return guard(async () => {
    await commit(groups.setRole({ uid, ...(await context(uid, groupId)), target: await optional<GroupMemberDoc>(`groupMembers/${groupId}_${targetUid}`), role, clock: serverClock() }));
    return { updated: true };
  });
});

export const createGroupPost = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    const { writes, result } = groups.createPost({ uid, ...(await context(uid, groupId)), kind: (body.kind as GroupPostDoc["kind"]) ?? "post", title: String(body.title ?? ""), body: String(body.body ?? ""), postId: db.collection("groupPosts").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const createGroupReply = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const postId = requireString(body.postId, "postId", 80);
  return guard(async () => {
    const post = await optional<GroupPostDoc>(`groupPosts/${postId}`);
    if (!post) throw new HttpsError("not-found", "Post not found.");
    const { writes, result } = groups.createReply({ uid, ...(await context(uid, post.groupId)), post, body: String(body.body ?? ""), replyId: db.collection("groupReplies").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const reactToGroupPost = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const postId = requireString(body.postId, "postId", 80);
  const emoji = requireString(body.emoji, "emoji", 4);
  return guard(async () => {
    const post = await optional<GroupPostDoc>(`groupPosts/${postId}`);
    if (!post) throw new HttpsError("not-found", "Post not found.");
    const { writes, result } = groups.reactToPost({ uid, ...(await context(uid, post.groupId)), post, existing: await optional<GroupPostReactionDoc>(`groupPostReactions/${postId}_${uid}`), emoji, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const markGroupHelpful = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const targetType = body.targetType === "reply" ? "reply" : "post";
  const targetId = requireString(body.targetId, "targetId", 80);
  return guard(async () => {
    const target = await optional<GroupPostDoc | GroupReplyDoc>(`${targetType === "post" ? "groupPosts" : "groupReplies"}/${targetId}`);
    if (!target) throw new HttpsError("not-found", "Not found.");
    const { writes, result } = groups.markHelpful({ uid, ...(await context(uid, target.groupId)), target, targetType });
    await commit(writes);
    return result;
  });
});

export const moderateGroupContent = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const targetType = body.targetType === "reply" ? "reply" : "post";
  const targetId = requireString(body.targetId, "targetId", 80);
  return guard(async () => {
    const target = await optional<GroupPostDoc | GroupReplyDoc>(`${targetType === "post" ? "groupPosts" : "groupReplies"}/${targetId}`);
    if (!target) throw new HttpsError("not-found", "Not found.");
    await commit(groups.moderate({ uid, ...(await context(uid, target.groupId)), targetType, target, hidden: body.hidden === true }));
    return { hidden: body.hidden === true };
  });
});

export const reportInGroup = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    const { writes, result } = groups.reportInGroup({ uid, ...(await context(uid, groupId)), targetType: body.targetType as "post" | "reply" | "member", targetId: String(body.targetId ?? ""), reason: body.reason as ReportReason, details: String(body.details ?? ""), reportId: db.collection("groupReports").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const groupSessionAction = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  const action = requireString(body.action, "action", 10) as RoomAction;
  if (!ROOM_ACTIONS.includes(action)) throw new HttpsError("invalid-argument", "Unknown room action.");
  const config = await loadConfig();
  const historyId = `${groupId}_${db.collection("ids").doc().id}`;
  return db.runTransaction(async (txn) => {
    const [groupSnap, memberSnap, sessionSnap] = await txn.getAll(db.doc(`groups/${groupId}`), db.doc(`groupMembers/${groupId}_${uid}`), db.doc(`groupSessions/${groupId}_live`));
    try {
      groups.requireGroupMember(uid, groupSnap.exists ? (groupSnap.data() as GroupDoc) : null, memberSnap.exists ? (memberSnap.data() as GroupMemberDoc) : null);
      const session = sessionSnap.exists ? (sessionSnap.data() as GroupSessionDoc) : { status: "idle" as const, startedAt: null, resumedAt: null, accumulatedSec: 0, participants: {}, startedBy: null, updatedAt: null };
      const contexts = new Map<string, OutcomeContext>();
      if (action === "stop") for (const participant of Object.keys(session.participants)) contexts.set(participant, await readUserContext(txn, participant, stopEventId(participant, "group", historyId), config));
      const { writes, result } = applyRoomAction({ uid, session, action, livePath: `groupSessions/${groupId}_live`, historyPath: `groupSessions/${historyId}`, historyExtra: { groupId }, kind: "group", contexts, clock: serverClock() });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});

export const createGroupChallenge = onCall(async (request) => {
  const uid = requireUid(request);
  const body = data(request);
  const groupId = requireString(body.groupId, "groupId", 80);
  return guard(async () => {
    const { writes, result } = groups.createGroupChallenge({ uid, ...(await context(uid, groupId)), kind: requireString(body.kind, "kind", 20) as ChallengeKind, target: requireNumber(body.target, "target", 1, 100_000), days: requireNumber(body.days ?? 14, "days", 1, 30), challengeId: db.collection("groupChallenges").doc().id, clock: serverClock() });
    await commit(writes);
    return result;
  });
});

export const refreshGroupChallenge = onCall(async (request) => {
  const uid = requireUid(request);
  const challengeId = requireString(data(request).challengeId, "challengeId", 80);
  const challenge = await optional<GroupChallengeDoc>(`groupChallenges/${challengeId}`);
  if (!challenge) throw new HttpsError("not-found", "Challenge not found.");
  const ctx = await context(uid, challenge.groupId);
  try {
    groups.requireGroupMember(uid, ctx.group, ctx.member);
  } catch (error) {
    return rethrow(error);
  }
  const membersSnap = await db.collection("groupMembers").where("groupId", "==", challenge.groupId).get();
  const memberUids = membersSnap.docs.map((doc) => (doc.data() as GroupMemberDoc).uid);
  const sinceMs = toMillis(challenge.startsAt) ?? 0;
  const counts: Record<string, number> = {};
  for (const member of memberUids) counts[member] = await activitySince(member, sinceMs, challenge.kind);
  const config = await loadConfig();
  return db.runTransaction(async (txn) => {
    const contexts = new Map<string, OutcomeContext>();
    for (const member of memberUids) contexts.set(member, await readUserContext(txn, member, `challenge_${challenge.id}_${member}`, config));
    try {
      const { writes, result } = groups.refreshGroupChallenge({ uid, ...ctx, challenge, counts, contexts, clock: serverClock() });
      applyWrites(txnSink(txn), writes);
      return result;
    } catch (error) {
      return rethrow(error);
    }
  });
});
