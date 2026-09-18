// Pure Groups logic. Every mutation re-checks membership and role from documents the caller read;
// the client never assigns roles, and posts pass the contact-sharing filter before they are stored.
import { computeOutcome, notificationOp, toMillis, type OutcomeContext } from "./outcome.js";
import { LogicError } from "./learning.js";
import { contactSharingMessage, findContactSharing } from "./safety.js";
import { CHALLENGE_TARGETS } from "./buddy.js";
import type { Clock, WriteOp } from "./writes.js";
import {
  DEFAULT_NOTIFICATION_PREFS, GROUP_COVERS, REACTIONS,
  type ChallengeKind, type ClassLevel, type GroupChallengeDoc, type GroupDoc, type GroupFocus, type GroupInvitationDoc, type GroupInviteCodeDoc, type GroupJoinRequestDoc,
  type GroupMemberDoc, type GroupPostDoc, type GroupPostReactionDoc, type GroupReplyDoc, type GroupRole, type LearningPath, type PublicProfile, type ReportReason, type SubjectId
} from "../types.js";

const SUBJECTS: readonly SubjectId[] = ["physics", "chemistry", "mathematics", "biology"];
const FOCUS: readonly GroupFocus[] = ["class", "jee", "neet", "subject", "chapter", "project", "goal"];
const PATHS: readonly LearningPath[] = ["school", "jee", "neet"];
const REPORT_REASONS: readonly ReportReason[] = ["spam", "abuse", "irrelevant", "inappropriate", "harassment", "contact_sharing", "other"];
export const MAX_MEMBERS_LIMIT = 50;

export interface GroupInput {
  name: string;
  description: string;
  privacy: "public" | "private";
  focus: GroupFocus;
  classLevel: ClassLevel | null;
  path: LearningPath | null;
  subjectId: SubjectId | null;
  chapterId: string | null;
  studyGoal: string;
  rules: string;
  maxMembers: number;
  cover: string;
}

function text(value: unknown, field: string, max: number, min = 0): string {
  if (typeof value !== "string") throw new LogicError("invalid-argument", `Invalid ${field}.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new LogicError("invalid-argument", `${field} must be ${min ? `${min} to ` : "at most "}${max} characters.`);
  return trimmed;
}

/** Validates group fields against the subject whitelist and sane limits. Throws LogicError on anything off. */
export function validateGroupInput(raw: Record<string, unknown>): GroupInput {
  const name = text(raw.name, "Group name", 60, 3);
  const description = text(raw.description ?? "", "Description", 500);
  const privacy = raw.privacy === "private" ? "private" : "public";
  const focus = raw.focus as GroupFocus;
  if (!FOCUS.includes(focus)) throw new LogicError("invalid-argument", "Invalid group type.");
  const classLevel = raw.classLevel === null || raw.classLevel === undefined ? null : (raw.classLevel as ClassLevel);
  if (classLevel !== null && ![9, 10, 11, 12].includes(classLevel)) throw new LogicError("invalid-argument", "Invalid class.");
  const path = raw.path === null || raw.path === undefined ? null : (raw.path as LearningPath);
  if (path !== null && !PATHS.includes(path)) throw new LogicError("invalid-argument", "Invalid learning path.");
  const subjectId = raw.subjectId === null || raw.subjectId === undefined || raw.subjectId === "" ? null : (raw.subjectId as SubjectId);
  if (subjectId !== null && !SUBJECTS.includes(subjectId)) throw new LogicError("invalid-argument", "Only Physics, Chemistry, Mathematics and Biology groups exist.");
  if (path === "jee" && subjectId === "biology") throw new LogicError("invalid-argument", "Biology is not a JEE subject.");
  if (path === "neet" && subjectId === "mathematics") throw new LogicError("invalid-argument", "Mathematics is not a NEET subject.");
  const chapterId = typeof raw.chapterId === "string" && raw.chapterId.length <= 120 ? raw.chapterId : null;
  const studyGoal = text(raw.studyGoal ?? "", "Study goal", 200);
  const rules = text(raw.rules ?? "", "Group rules", 500);
  const maxMembers = Number(raw.maxMembers ?? 20);
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > MAX_MEMBERS_LIMIT) throw new LogicError("invalid-argument", `Maximum members must be between 2 and ${MAX_MEMBERS_LIMIT}.`);
  const cover = (GROUP_COVERS as readonly string[]).includes(raw.cover as string) ? (raw.cover as string) : "orbit";
  for (const field of [name, description, studyGoal, rules]) {
    const contact = findContactSharing(field);
    if (contact) throw new LogicError("invalid-argument", contactSharingMessage(contact));
  }
  return { name, description, privacy, focus, classLevel, path, subjectId, chapterId, studyGoal, rules, maxMembers, cover };
}

export function memberDoc(groupId: string, profile: PublicProfile, role: GroupRole, clock: Clock): GroupMemberDoc {
  return { id: `${groupId}_${profile.uid}`, groupId, uid: profile.uid, role, anonUsername: profile.anonUsername, avatar: profile.avatar, joinedAt: clock.stamp };
}

export function createGroup(input: { uid: string; profile: PublicProfile; groupId: string; fields: GroupInput; clock: Clock }): { writes: WriteOp[]; result: { groupId: string } } {
  const { fields, clock } = input;
  const group: GroupDoc = {
    id: input.groupId, name: fields.name, nameLower: fields.name.toLowerCase(), description: fields.description, cover: fields.cover, privacy: fields.privacy, focus: fields.focus,
    classLevel: fields.classLevel, path: fields.path, subjectId: fields.subjectId, chapterId: fields.chapterId, studyGoal: fields.studyGoal, rules: fields.rules, maxMembers: fields.maxMembers,
    memberCount: 1, ownerUid: input.uid, resources: [], postCount: 0, status: "active", createdAt: clock.stamp, updatedAt: clock.stamp
  };
  return {
    writes: [
      { path: `groups/${group.id}`, data: group as unknown as Record<string, unknown> },
      { path: `groupMembers/${group.id}_${input.uid}`, data: memberDoc(group.id, input.profile, "owner", clock) as unknown as Record<string, unknown> },
      { path: `groupSessions/${group.id}_live`, data: { id: `${group.id}_live`, groupId: group.id, status: "idle", startedAt: null, resumedAt: null, accumulatedSec: 0, participants: {}, startedBy: null, updatedAt: clock.stamp, finalizedAt: null } }
    ],
    result: { groupId: group.id }
  };
}

export function requireGroupMember(uid: string, group: GroupDoc | null, member: GroupMemberDoc | null): { group: GroupDoc; member: GroupMemberDoc } {
  if (!group || group.status !== "active") throw new LogicError("not-found", "Group not found.");
  if (!member || member.uid !== uid || member.groupId !== group.id) throw new LogicError("permission-denied", "You are not a member of this group.");
  return { group, member };
}

export function requireStaff(uid: string, group: GroupDoc | null, member: GroupMemberDoc | null): { group: GroupDoc; member: GroupMemberDoc } {
  const checked = requireGroupMember(uid, group, member);
  if (checked.member.role !== "owner" && checked.member.role !== "admin") throw new LogicError("permission-denied", "Only the group owner or an admin can do that.");
  return checked;
}

export function updateGroup(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; fields: GroupInput; resources: { title: string; url: string }[] | null; clock: Clock }): WriteOp[] {
  const { group } = requireStaff(input.uid, input.group, input.member);
  if (input.fields.maxMembers < group.memberCount) throw new LogicError("invalid-argument", `The group already has ${group.memberCount} members.`);
  const resources = input.resources === null ? group.resources : input.resources.slice(0, 30).map((row) => ({ title: text(row.title, "Resource title", 120, 1), url: typeof row.url === "string" ? row.url.slice(0, 500) : "" }));
  const { name, ...rest } = input.fields;
  return [{ path: `groups/${group.id}`, merge: true, data: { name, nameLower: name.toLowerCase(), ...rest, resources, updatedAt: input.clock.stamp } }];
}

// ---------- joining ----------

export function requestJoin(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; pending: GroupJoinRequestDoc | null; message: string; requestId: string; clock: Clock }): { writes: WriteOp[]; result: { requestId: string } } {
  const { group } = input;
  if (!group || group.status !== "active") throw new LogicError("not-found", "Group not found.");
  if (group.privacy !== "public") throw new LogicError("permission-denied", "This group is private. Ask for an invite or a code.");
  if (input.member) throw new LogicError("already-exists", "You are already a member.");
  if (group.memberCount >= group.maxMembers) throw new LogicError("failed-precondition", "This group is full.");
  if (input.pending?.status === "pending") throw new LogicError("already-exists", "Your request is already waiting for approval.");
  const message = text(input.message ?? "", "Message", 200);
  const contact = findContactSharing(message);
  if (contact) throw new LogicError("invalid-argument", contactSharingMessage(contact));
  return { writes: [{ path: `groupJoinRequests/${input.requestId}`, data: { id: input.requestId, groupId: group.id, uid: input.uid, message, status: "pending", createdAt: input.clock.stamp, decidedBy: null, decidedAt: null } }], result: { requestId: input.requestId } };
}

export function respondJoinRequest(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; request: GroupJoinRequestDoc; approve: boolean; requesterProfile: PublicProfile | null; requesterMember: GroupMemberDoc | null; clock: Clock }): { writes: WriteOp[]; result: { status: "approved" | "rejected" } } {
  const { group } = requireStaff(input.uid, input.group, input.member);
  const { request, clock } = input;
  if (request.groupId !== group.id || request.status !== "pending") throw new LogicError("failed-precondition", "This request was already decided.");
  const writes: WriteOp[] = [{ path: `groupJoinRequests/${request.id}`, merge: true, data: { status: input.approve ? "approved" : "rejected", decidedBy: input.uid, decidedAt: clock.stamp } }];
  if (!input.approve) return { writes, result: { status: "rejected" } };
  if (!input.requesterProfile) throw new LogicError("not-found", "Student not found.");
  if (input.requesterMember) return { writes, result: { status: "approved" } };
  if (group.memberCount >= group.maxMembers) throw new LogicError("failed-precondition", "This group is full.");
  writes.push({ path: `groupMembers/${group.id}_${request.uid}`, data: memberDoc(group.id, input.requesterProfile, "member", clock) as unknown as Record<string, unknown> });
  writes.push({ path: `groups/${group.id}`, merge: true, data: { memberCount: group.memberCount + 1, updatedAt: clock.stamp } });
  const op = notificationOp(request.uid, DEFAULT_NOTIFICATION_PREFS, "group", "Request approved", `You are now a member of ${group.name}.`, `/groups/${group.id}`, clock);
  if (op) writes.push(op);
  return { writes, result: { status: "approved" } };
}

export function createInviteCode(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; code: string; expiresInHours: number; maxUses: number; clock: Clock }): { writes: WriteOp[]; result: { code: string; expiresAt: number } } {
  const { group } = requireStaff(input.uid, input.group, input.member);
  const hours = Math.max(1, Math.min(24 * 30, Math.round(input.expiresInHours)));
  const maxUses = Math.max(1, Math.min(100, Math.round(input.maxUses)));
  const expiresAt = input.clock.now.getTime() + hours * 3600_000;
  const doc: GroupInviteCodeDoc = { id: input.code, code: input.code, groupId: group.id, createdBy: input.uid, expiresAt: new Date(expiresAt), maxUses, uses: 0, revoked: false, createdAt: input.clock.stamp };
  return { writes: [{ path: `groupInviteCodes/${input.code}`, data: doc as unknown as Record<string, unknown> }], result: { code: input.code, expiresAt } };
}

export function revokeInviteCode(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; code: GroupInviteCodeDoc | null; clock: Clock }): WriteOp[] {
  const { group } = requireStaff(input.uid, input.group, input.member);
  if (!input.code || input.code.groupId !== group.id) throw new LogicError("not-found", "Code not found.");
  return [{ path: `groupInviteCodes/${input.code.code}`, merge: true, data: { revoked: true } }];
}

export function joinWithCode(input: { uid: string; profile: PublicProfile; code: GroupInviteCodeDoc | null; group: GroupDoc | null; member: GroupMemberDoc | null; clock: Clock }): { writes: WriteOp[]; result: { groupId: string; alreadyMember: boolean } } {
  const { code, group, clock } = input;
  if (!code || !group || group.status !== "active") throw new LogicError("not-found", "That invite code is not valid.");
  if (input.member) return { writes: [], result: { groupId: group.id, alreadyMember: true } };
  if (code.revoked) throw new LogicError("failed-precondition", "That invite code was revoked.");
  const expiresMs = toMillis(code.expiresAt);
  if (expiresMs !== null && clock.now.getTime() > expiresMs) throw new LogicError("failed-precondition", "That invite code has expired.");
  if (code.uses >= code.maxUses) throw new LogicError("failed-precondition", "That invite code has been used up.");
  if (group.memberCount >= group.maxMembers) throw new LogicError("failed-precondition", "This group is full.");
  return {
    writes: [
      { path: `groupInviteCodes/${code.code}`, merge: true, data: { uses: code.uses + 1 } },
      { path: `groupMembers/${group.id}_${input.uid}`, data: memberDoc(group.id, input.profile, "member", clock) as unknown as Record<string, unknown> },
      { path: `groups/${group.id}`, merge: true, data: { memberCount: group.memberCount + 1, updatedAt: clock.stamp } }
    ],
    result: { groupId: group.id, alreadyMember: false }
  };
}

export function invite(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; toProfile: PublicProfile | null; toMember: GroupMemberDoc | null; pending: GroupInvitationDoc | null; invitationId: string; clock: Clock }): { writes: WriteOp[]; result: { invitationId: string } } {
  const { group, member } = requireStaff(input.uid, input.group, input.member);
  if (!input.toProfile) throw new LogicError("not-found", "No student with that username.");
  if (input.toProfile.uid === input.uid) throw new LogicError("invalid-argument", "You are already here.");
  if (input.toMember) throw new LogicError("already-exists", "That student is already a member.");
  if (input.pending?.status === "pending") throw new LogicError("already-exists", "An invitation is already waiting.");
  const writes: WriteOp[] = [{ path: `groupInvitations/${input.invitationId}`, data: { id: input.invitationId, groupId: group.id, groupName: group.name, fromUid: input.uid, toUid: input.toProfile.uid, status: "pending", createdAt: input.clock.stamp, respondedAt: null } }];
  const op = notificationOp(input.toProfile.uid, DEFAULT_NOTIFICATION_PREFS, "group", "Group invitation", `${member.anonUsername} invited you to join ${group.name}.`, "/groups", input.clock);
  if (op) writes.push(op);
  return { writes, result: { invitationId: input.invitationId } };
}

export function respondInvitation(input: { uid: string; profile: PublicProfile; invitation: GroupInvitationDoc; accept: boolean; group: GroupDoc | null; member: GroupMemberDoc | null; clock: Clock }): { writes: WriteOp[]; result: { status: "accepted" | "declined"; groupId: string } } {
  const { invitation, clock } = input;
  if (invitation.toUid !== input.uid) throw new LogicError("permission-denied", "This invitation is not for you.");
  if (invitation.status !== "pending") throw new LogicError("failed-precondition", "This invitation was already answered.");
  const writes: WriteOp[] = [{ path: `groupInvitations/${invitation.id}`, merge: true, data: { status: input.accept ? "accepted" : "declined", respondedAt: clock.stamp } }];
  if (!input.accept) return { writes, result: { status: "declined", groupId: invitation.groupId } };
  if (!input.group || input.group.status !== "active") throw new LogicError("not-found", "Group not found.");
  if (!input.member) {
    if (input.group.memberCount >= input.group.maxMembers) throw new LogicError("failed-precondition", "This group is full.");
    writes.push({ path: `groupMembers/${input.group.id}_${input.uid}`, data: memberDoc(input.group.id, input.profile, "member", clock) as unknown as Record<string, unknown> });
    writes.push({ path: `groups/${input.group.id}`, merge: true, data: { memberCount: input.group.memberCount + 1, updatedAt: clock.stamp } });
  }
  return { writes, result: { status: "accepted", groupId: invitation.groupId } };
}

// ---------- membership and roles ----------

export function leaveGroup(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; others: GroupMemberDoc[]; clock: Clock }): { writes: WriteOp[]; result: { archived: boolean; newOwner: string | null } } {
  const { group, member } = requireGroupMember(input.uid, input.group, input.member);
  const writes: WriteOp[] = [{ path: `groupMembers/${member.id}`, delete: true }];
  let newOwner: string | null = null;
  if (member.role === "owner") {
    const successor = [...input.others].sort((left, right) => (left.role === "admin" ? 0 : 1) - (right.role === "admin" ? 0 : 1) || (toMillis(left.joinedAt) ?? 0) - (toMillis(right.joinedAt) ?? 0))[0];
    if (!successor) {
      writes.push({ path: `groups/${group.id}`, merge: true, data: { memberCount: 0, status: "archived", updatedAt: input.clock.stamp } });
      return { writes, result: { archived: true, newOwner: null } };
    }
    newOwner = successor.uid;
    writes.push({ path: `groupMembers/${successor.id}`, merge: true, data: { role: "owner" } });
  }
  writes.push({ path: `groups/${group.id}`, merge: true, data: { memberCount: Math.max(0, group.memberCount - 1), ...(newOwner ? { ownerUid: newOwner } : {}), updatedAt: input.clock.stamp } });
  return { writes, result: { archived: false, newOwner } };
}

export function removeMember(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; target: GroupMemberDoc | null; clock: Clock }): WriteOp[] {
  const { group, member } = requireStaff(input.uid, input.group, input.member);
  if (!input.target || input.target.groupId !== group.id) throw new LogicError("not-found", "Member not found.");
  if (input.target.uid === input.uid) throw new LogicError("invalid-argument", "Use Leave to remove yourself.");
  if (input.target.role === "owner") throw new LogicError("permission-denied", "The owner cannot be removed.");
  if (member.role === "admin" && input.target.role === "admin") throw new LogicError("permission-denied", "Admins cannot remove other admins.");
  return [
    { path: `groupMembers/${input.target.id}`, delete: true },
    { path: `groups/${group.id}`, merge: true, data: { memberCount: Math.max(0, group.memberCount - 1), updatedAt: input.clock.stamp } }
  ];
}

/** Only the owner changes roles. Making someone else owner demotes the current owner to admin. */
export function setRole(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; target: GroupMemberDoc | null; role: GroupRole; clock: Clock }): WriteOp[] {
  const { group, member } = requireGroupMember(input.uid, input.group, input.member);
  if (member.role !== "owner") throw new LogicError("permission-denied", "Only the owner can change roles.");
  if (!input.target || input.target.groupId !== group.id || input.target.uid === input.uid) throw new LogicError("invalid-argument", "Pick another member.");
  if (!["owner", "admin", "member"].includes(input.role)) throw new LogicError("invalid-argument", "Invalid role.");
  const writes: WriteOp[] = [{ path: `groupMembers/${input.target.id}`, merge: true, data: { role: input.role } }];
  if (input.role === "owner") {
    writes.push({ path: `groupMembers/${member.id}`, merge: true, data: { role: "admin" } });
    writes.push({ path: `groups/${group.id}`, merge: true, data: { ownerUid: input.target.uid, updatedAt: input.clock.stamp } });
  }
  return writes;
}

// ---------- discussion ----------

export function createPost(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; kind: GroupPostDoc["kind"]; title: string; body: string; postId: string; clock: Clock }): { writes: WriteOp[]; result: { postId: string } } {
  const { group, member } = requireGroupMember(input.uid, input.group, input.member);
  if (!["post", "question", "announcement"].includes(input.kind)) throw new LogicError("invalid-argument", "Invalid post type.");
  if (input.kind === "announcement" && member.role === "member") throw new LogicError("permission-denied", "Only the owner or an admin can post announcements.");
  const title = text(input.title, "Title", 120, 3);
  const body = text(input.body, "Post", 3000, 1);
  const contact = findContactSharing(`${title} ${body}`);
  if (contact) throw new LogicError("invalid-argument", contactSharingMessage(contact));
  const post: GroupPostDoc = { id: input.postId, groupId: group.id, authorUid: input.uid, authorName: member.anonUsername, kind: input.kind, title, body, reactions: {}, helpfulBy: [], helpfulCount: 0, replyCount: 0, hidden: false, createdAt: input.clock.stamp };
  return { writes: [{ path: `groupPosts/${post.id}`, data: post as unknown as Record<string, unknown> }, { path: `groups/${group.id}`, merge: true, data: { postCount: group.postCount + 1, updatedAt: input.clock.stamp } }], result: { postId: post.id } };
}

export function createReply(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; post: GroupPostDoc | null; body: string; replyId: string; clock: Clock }): { writes: WriteOp[]; result: { replyId: string } } {
  const { group, member } = requireGroupMember(input.uid, input.group, input.member);
  if (!input.post || input.post.groupId !== group.id || input.post.hidden) throw new LogicError("not-found", "Post not found.");
  const body = text(input.body, "Reply", 2000, 1);
  const contact = findContactSharing(body);
  if (contact) throw new LogicError("invalid-argument", contactSharingMessage(contact));
  const reply: GroupReplyDoc = { id: input.replyId, groupId: group.id, postId: input.post.id, authorUid: input.uid, authorName: member.anonUsername, body, helpfulBy: [], helpfulCount: 0, hidden: false, createdAt: input.clock.stamp };
  return { writes: [{ path: `groupReplies/${reply.id}`, data: reply as unknown as Record<string, unknown> }, { path: `groupPosts/${input.post.id}`, merge: true, data: { replyCount: input.post.replyCount + 1 } }], result: { replyId: reply.id } };
}

/** Toggle one reaction per student per post; counts live on the post, the student's choice in groupPostReactions. */
export function reactToPost(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; post: GroupPostDoc | null; existing: GroupPostReactionDoc | null; emoji: string; clock: Clock }): { writes: WriteOp[]; result: { reactions: Record<string, number>; mine: string | null } } {
  const { group } = requireGroupMember(input.uid, input.group, input.member);
  if (!input.post || input.post.groupId !== group.id) throw new LogicError("not-found", "Post not found.");
  if (!(REACTIONS as readonly string[]).includes(input.emoji)) throw new LogicError("invalid-argument", "Unknown reaction.");
  const reactions = { ...input.post.reactions };
  const id = `${input.post.id}_${input.uid}`;
  const writes: WriteOp[] = [];
  let mine: string | null = input.emoji;
  if (input.existing) {
    reactions[input.existing.emoji] = Math.max(0, (reactions[input.existing.emoji] ?? 1) - 1);
    if (input.existing.emoji === input.emoji) {
      writes.push({ path: `groupPostReactions/${id}`, delete: true });
      mine = null;
    }
  }
  if (mine) {
    reactions[input.emoji] = (reactions[input.emoji] ?? 0) + 1;
    writes.push({ path: `groupPostReactions/${id}`, data: { id, postId: input.post.id, groupId: group.id, uid: input.uid, emoji: input.emoji, createdAt: input.clock.stamp } });
  }
  writes.push({ path: `groupPosts/${input.post.id}`, merge: true, data: { reactions } });
  return { writes, result: { reactions, mine } };
}

export function markHelpful(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; target: (GroupPostDoc | GroupReplyDoc) & { kind?: string }; targetType: "post" | "reply" }): { writes: WriteOp[]; result: { helpfulCount: number; marked: boolean } } {
  const { group } = requireGroupMember(input.uid, input.group, input.member);
  if (input.target.groupId !== group.id) throw new LogicError("not-found", "Not found.");
  if (input.target.authorUid === input.uid) throw new LogicError("invalid-argument", "You cannot mark your own post as helpful.");
  const marked = !input.target.helpfulBy.includes(input.uid);
  const helpfulBy = marked ? [...input.target.helpfulBy, input.uid] : input.target.helpfulBy.filter((uid) => uid !== input.uid);
  return { writes: [{ path: `${input.targetType === "post" ? "groupPosts" : "groupReplies"}/${input.target.id}`, merge: true, data: { helpfulBy, helpfulCount: helpfulBy.length } }], result: { helpfulCount: helpfulBy.length, marked } };
}

export function moderate(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; targetType: "post" | "reply"; target: GroupPostDoc | GroupReplyDoc | null; hidden: boolean }): WriteOp[] {
  const { group } = requireStaff(input.uid, input.group, input.member);
  if (!input.target || input.target.groupId !== group.id) throw new LogicError("not-found", "Not found.");
  return [{ path: `${input.targetType === "post" ? "groupPosts" : "groupReplies"}/${input.target.id}`, merge: true, data: { hidden: input.hidden } }];
}

export function reportInGroup(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; targetType: "post" | "reply" | "member"; targetId: string; reason: ReportReason; details: string; reportId: string; clock: Clock }): { writes: WriteOp[]; result: { reportId: string } } {
  const { group } = requireGroupMember(input.uid, input.group, input.member);
  if (!REPORT_REASONS.includes(input.reason)) throw new LogicError("invalid-argument", "Invalid reason.");
  if (!["post", "reply", "member"].includes(input.targetType)) throw new LogicError("invalid-argument", "Invalid target.");
  const details = text(input.details ?? "", "Details", 1000);
  return { writes: [{ path: `groupReports/${input.reportId}`, data: { id: input.reportId, groupId: group.id, reporterUid: input.uid, targetType: input.targetType, targetId: text(input.targetId, "Target", 160, 1), reason: input.reason, details, status: "open", createdAt: input.clock.stamp } }], result: { reportId: input.reportId } };
}

// ---------- challenges (group total, no leaderboard) ----------

export function createGroupChallenge(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; kind: ChallengeKind; target: number; days: number; challengeId: string; clock: Clock }): { writes: WriteOp[]; result: { challengeId: string } } {
  const { group } = requireStaff(input.uid, input.group, input.member);
  const bounds = CHALLENGE_TARGETS[input.kind];
  if (!bounds) throw new LogicError("invalid-argument", "Unknown challenge kind.");
  const max = bounds.max * 10;
  if (!Number.isInteger(input.target) || input.target < bounds.min || input.target > max) throw new LogicError("invalid-argument", `Target must be between ${bounds.min} and ${max} ${bounds.unit}.`);
  const days = Math.max(1, Math.min(30, Math.round(input.days)));
  const titles: Record<ChallengeKind, string> = { study_minutes: `Study ${input.target} minutes together`, questions: `Complete ${input.target} questions together`, chapter: `Finish ${input.target} chapter${input.target > 1 ? "s" : ""} together`, assessment: `Complete ${input.target} assessment${input.target > 1 ? "s" : ""} together` };
  const challenge: GroupChallengeDoc = { id: input.challengeId, groupId: group.id, kind: input.kind, target: input.target, title: titles[input.kind], progress: {}, totalProgress: 0, completed: false, rewardedUids: [], startsAt: input.clock.stamp, endsAt: new Date(input.clock.now.getTime() + days * 86_400_000), createdBy: input.uid, createdAt: input.clock.stamp };
  return { writes: [{ path: `groupChallenges/${challenge.id}`, data: challenge as unknown as Record<string, unknown> }], result: { challengeId: challenge.id } };
}

/** Group total from every member's validated activity; every contributing member is paid once when the group reaches the target. */
export function refreshGroupChallenge(input: { uid: string; group: GroupDoc | null; member: GroupMemberDoc | null; challenge: GroupChallengeDoc; counts: Record<string, number>; contexts: Map<string, OutcomeContext>; clock: Clock }): { writes: WriteOp[]; result: { progress: Record<string, number>; totalProgress: number; completed: boolean; rewarded: string[] } } {
  const { group } = requireGroupMember(input.uid, input.group, input.member);
  const { challenge, clock } = input;
  if (challenge.groupId !== group.id) throw new LogicError("not-found", "Challenge not found.");
  const progress: Record<string, number> = {};
  for (const [uid, count] of Object.entries(input.counts)) progress[uid] = Math.max(0, count);
  const totalProgress = Math.min(challenge.target, Object.values(progress).reduce((sum, value) => sum + value, 0));
  const expired = toMillis(challenge.endsAt) !== null && clock.now.getTime() > (toMillis(challenge.endsAt) as number);
  const completed = challenge.completed || (totalProgress >= challenge.target && !expired);
  const writes: WriteOp[] = [];
  const rewarded: string[] = [];
  if (completed) {
    for (const [uid, count] of Object.entries(progress)) {
      const ctx = input.contexts.get(uid);
      if (count <= 0 || challenge.rewardedUids.includes(uid) || !ctx || ctx.eventDone) continue;
      writes.push(...computeOutcome(ctx, { eventId: `challenge_${challenge.id}_${uid}`, reason: "group_challenge", refId: challenge.id, xp: ctx.config.challengeXp, coins: ctx.config.challengeCoins }, clock).writes);
      rewarded.push(uid);
    }
  }
  writes.unshift({ path: `groupChallenges/${challenge.id}`, merge: true, data: { progress, totalProgress, completed, rewardedUids: [...challenge.rewardedUids, ...rewarded] } });
  return { writes, result: { progress, totalProgress, completed, rewarded } };
}
