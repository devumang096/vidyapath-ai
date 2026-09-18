import { describe, expect, it } from "vitest";
import * as groups from "../lib/groups.js";
import { applyRoomAction } from "../lib/room.js";
import type { OutcomeContext } from "../lib/outcome.js";
import type { Clock, WriteOp } from "../lib/writes.js";
import { DEFAULT_NOTIFICATION_PREFS, type GroupDoc, type GroupInviteCodeDoc, type GroupMemberDoc, type GroupPostDoc, type PublicProfile, type RewardConfig } from "../types.js";

const T0 = Date.parse("2026-09-19T05:00:00Z");
const at = (ms = T0): Clock => ({ now: new Date(ms), today: "2026-09-19", stamp: new Date(ms), newId: () => "n" });
const config = { challengeXp: 150, challengeCoins: 20, studyMinuteXp: 1, streakDayMinutes: 20, streakDayQuestions: 10, streakMilestones: [1] } as RewardConfig;
const find = (writes: WriteOp[], path: string) => (writes.find((write) => write.path === path && !("delete" in write)) as { data: Record<string, unknown> } | undefined)?.data;
const deleted = (writes: WriteOp[], path: string) => writes.some((write) => write.path === path && "delete" in write);

function profile(uid: string): PublicProfile {
  return { uid, anonUsername: `Anon${uid}`, avatar: "avatar-1", classLevel: 10, goal: "school", subjects: ["physics"], language: "en", learningLevel: "beginner", progressSummary: { accuracy: 0, questionsSolved: 0, lessonsCompleted: 0 }, buddyStatus: "none", buddyPairId: null, updatedAt: null };
}
function ctx(uid: string, overrides: Partial<OutcomeContext> = {}): OutcomeContext {
  return {
    uid, config,
    user: { uid, email: "", name: "", classLevel: 10, goal: "school", subjects: ["physics"], language: "en", learningLevel: "beginner", dailyGoalMinutes: 60, school: null, phone: null, photoURL: null, onboardingComplete: true, notificationPrefs: DEFAULT_NOTIFICATION_PREFS, role: "student", xp: 0, coins: 0, questionsSolved: 0, lessonsCompleted: 0, chaptersCompleted: 0, assessmentsCompleted: 0, totalStudyMinutes: 0, activeDays: 0, badgeIds: [], createdAt: null, updatedAt: null },
    streak: { current: 0, longest: 0, lastQualifiedDate: null, protectionTokens: 0, milestonesAwarded: [] },
    activity: { minutes: 0, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: false },
    eventDone: false, ...overrides
  };
}
const fields = groups.validateGroupInput({ name: "Class 10 Physics", description: "Motion and more", privacy: "public", focus: "subject", classLevel: 10, path: "school", subjectId: "physics", studyGoal: "Finish Motion", rules: "Be kind", maxMembers: 3, cover: "atom" });
const created = groups.createGroup({ uid: "o", profile: profile("o"), groupId: "g1", fields, clock: at() });
const group = find(created.writes, "groups/g1") as unknown as GroupDoc;
const owner = find(created.writes, "groupMembers/g1_o") as unknown as GroupMemberDoc;
const member = (uid: string, role: GroupMemberDoc["role"] = "member"): GroupMemberDoc => ({ ...groups.memberDoc("g1", profile(uid), role, at()) });

describe("group creation and validation", () => {
  it("creates the group with the creator as owner and a live session", () => {
    expect(group).toMatchObject({ name: "Class 10 Physics", nameLower: "class 10 physics", privacy: "public", memberCount: 1, ownerUid: "o", cover: "atom" });
    expect(owner.role).toBe("owner");
    expect(find(created.writes, "groupSessions/g1_live")).toMatchObject({ status: "idle" });
  });
  it("rejects unsupported subjects, exam mismatches, bad sizes and contact details", () => {
    expect(() => groups.validateGroupInput({ ...fields, subjectId: "english" })).toThrow(/Only Physics/);
    expect(() => groups.validateGroupInput({ ...fields, path: "jee", subjectId: "biology" })).toThrow(/not a JEE subject/);
    expect(() => groups.validateGroupInput({ ...fields, path: "neet", subjectId: "mathematics" })).toThrow(/not a NEET subject/);
    expect(() => groups.validateGroupInput({ ...fields, maxMembers: 1 })).toThrow(/between 2 and 50/);
    expect(() => groups.validateGroupInput({ ...fields, name: "Hi" })).toThrow(/3 to 60/);
    expect(() => groups.validateGroupInput({ ...fields, description: "WhatsApp 9876543210" })).toThrow(/phone number/);
  });
  it("only staff can edit, and cannot shrink below the member count", () => {
    expect(() => groups.updateGroup({ uid: "m", group, member: member("m"), fields, resources: null, clock: at() })).toThrow(/owner or an admin/);
    expect(() => groups.updateGroup({ uid: "o", group: { ...group, memberCount: 3 }, member: owner, fields: { ...fields, maxMembers: 2 }, resources: null, clock: at() })).toThrow(/already has 3/);
    const writes = groups.updateGroup({ uid: "o", group, member: owner, fields, resources: [{ title: "Notes", url: "https://example.com/n" }], clock: at() });
    expect(find(writes, "groups/g1")).toMatchObject({ resources: [{ title: "Notes", url: "https://example.com/n" }] });
  });
});

describe("joining", () => {
  it("requests join to public groups only, staff approve into membership once", () => {
    expect(() => groups.requestJoin({ uid: "m", group: { ...group, privacy: "private" }, member: null, pending: null, message: "", requestId: "r1", clock: at() })).toThrow(/private/);
    expect(() => groups.requestJoin({ uid: "m", group, member: member("m"), pending: null, message: "", requestId: "r1", clock: at() })).toThrow(/already a member/);
    const { writes } = groups.requestJoin({ uid: "m", group, member: null, pending: null, message: "Hi", requestId: "r1", clock: at() });
    const request = find(writes, "groupJoinRequests/r1") as never;
    expect(() => groups.respondJoinRequest({ uid: "x", group, member: member("x"), request, approve: true, requesterProfile: profile("m"), requesterMember: null, clock: at() })).toThrow(/owner or an admin/);
    const approved = groups.respondJoinRequest({ uid: "o", group, member: owner, request, approve: true, requesterProfile: profile("m"), requesterMember: null, clock: at() });
    expect(find(approved.writes, "groupMembers/g1_m")).toMatchObject({ role: "member" });
    expect(find(approved.writes, "groups/g1")).toMatchObject({ memberCount: 2 });
    expect(() => groups.respondJoinRequest({ uid: "o", group: { ...group, memberCount: 3 }, member: owner, request, approve: true, requesterProfile: profile("m"), requesterMember: null, clock: at() })).toThrow(/full/);
    const rejected = groups.respondJoinRequest({ uid: "o", group, member: owner, request, approve: false, requesterProfile: profile("m"), requesterMember: null, clock: at() });
    expect(rejected.writes).toHaveLength(1);
  });
  it("invite codes honour revocation, expiry, usage limits and capacity", () => {
    const { writes, result } = groups.createInviteCode({ uid: "o", group, member: owner, code: "EDU-7K4P9", expiresInHours: 24, maxUses: 1, clock: at() });
    expect(result.code).toBe("EDU-7K4P9");
    const code = find(writes, "groupInviteCodes/EDU-7K4P9") as unknown as GroupInviteCodeDoc;
    const joined = groups.joinWithCode({ uid: "m", profile: profile("m"), code, group, member: null, clock: at(T0 + 1000) });
    expect(find(joined.writes, "groupMembers/g1_m")).toMatchObject({ role: "member" });
    expect(find(joined.writes, "groupInviteCodes/EDU-7K4P9")).toMatchObject({ uses: 1 });
    expect(() => groups.joinWithCode({ uid: "n", profile: profile("n"), code: { ...code, uses: 1 }, group, member: null, clock: at(T0 + 1000) })).toThrow(/used up/);
    expect(() => groups.joinWithCode({ uid: "n", profile: profile("n"), code: { ...code, revoked: true }, group, member: null, clock: at(T0 + 1000) })).toThrow(/revoked/);
    expect(() => groups.joinWithCode({ uid: "n", profile: profile("n"), code, group, member: null, clock: at(T0 + 25 * 3600_000) })).toThrow(/expired/);
    expect(() => groups.joinWithCode({ uid: "n", profile: profile("n"), code, group: { ...group, memberCount: 3 }, member: null, clock: at(T0 + 1000) })).toThrow(/full/);
    expect(groups.joinWithCode({ uid: "m", profile: profile("m"), code, group, member: member("m"), clock: at() }).result.alreadyMember).toBe(true);
    expect(() => groups.revokeInviteCode({ uid: "m", group, member: member("m"), code, clock: at() })).toThrow(/owner or an admin/);
  });
  it("invitations go to existing anonymous usernames and only the recipient can answer", () => {
    expect(() => groups.invite({ uid: "o", group, member: owner, toProfile: null, toMember: null, pending: null, invitationId: "i1", clock: at() })).toThrow(/No student/);
    const { writes } = groups.invite({ uid: "o", group, member: owner, toProfile: profile("m"), toMember: null, pending: null, invitationId: "i1", clock: at() });
    const invitation = find(writes, "groupInvitations/i1") as never;
    expect(writes.some((write) => write.path.startsWith("notifications/m/"))).toBe(true);
    expect(() => groups.respondInvitation({ uid: "z", profile: profile("z"), invitation, accept: true, group, member: null, clock: at() })).toThrow(/not for you/);
    const accepted = groups.respondInvitation({ uid: "m", profile: profile("m"), invitation, accept: true, group, member: null, clock: at() });
    expect(find(accepted.writes, "groupMembers/g1_m")).toBeDefined();
  });
});

describe("roles", () => {
  it("never lets a member promote themselves, and only the owner sets roles", () => {
    expect(() => groups.setRole({ uid: "a", group, member: member("a", "admin"), target: member("a", "admin"), role: "owner", clock: at() })).toThrow(/Only the owner/);
    const writes = groups.setRole({ uid: "o", group, member: owner, target: member("a"), role: "owner", clock: at() });
    expect(find(writes, "groupMembers/g1_a")).toMatchObject({ role: "owner" });
    expect(find(writes, "groupMembers/g1_o")).toMatchObject({ role: "admin" });
    expect(find(writes, "groups/g1")).toMatchObject({ ownerUid: "a" });
  });
  it("admins remove members but not admins or the owner; leaving as owner hands over or archives", () => {
    expect(() => groups.removeMember({ uid: "a", group, member: member("a", "admin"), target: member("b", "admin"), clock: at() })).toThrow(/cannot remove other admins/);
    expect(() => groups.removeMember({ uid: "a", group, member: member("a", "admin"), target: owner, clock: at() })).toThrow(/owner cannot be removed/);
    const removed = groups.removeMember({ uid: "a", group: { ...group, memberCount: 3 }, member: member("a", "admin"), target: member("b"), clock: at() });
    expect(deleted(removed, "groupMembers/g1_b")).toBe(true);
    expect(find(removed, "groups/g1")).toMatchObject({ memberCount: 2 });
    const handover = groups.leaveGroup({ uid: "o", group: { ...group, memberCount: 2 }, member: owner, others: [member("b")], clock: at() });
    expect(handover.result.newOwner).toBe("b");
    expect(find(handover.writes, "groupMembers/g1_b")).toMatchObject({ role: "owner" });
    const archive = groups.leaveGroup({ uid: "o", group, member: owner, others: [], clock: at() });
    expect(archive.result.archived).toBe(true);
  });
});

describe("discussion", () => {
  const post = find(groups.createPost({ uid: "m", group, member: member("m"), kind: "question", title: "Why is a negative?", body: "For retardation", postId: "p1", clock: at() }).writes, "groupPosts/p1") as unknown as GroupPostDoc;
  it("filters contact details and limits announcements to staff", () => {
    expect(() => groups.createPost({ uid: "m", group, member: member("m"), kind: "post", title: "Call me", body: "9876543210", postId: "p2", clock: at() })).toThrow(/phone number/);
    expect(() => groups.createPost({ uid: "m", group, member: member("m"), kind: "announcement", title: "Exam tomorrow", body: "Be ready", postId: "p3", clock: at() })).toThrow(/announcements/);
    expect(() => groups.createPost({ uid: "z", group, member: null, kind: "post", title: "Hello", body: "Hi", postId: "p4", clock: at() })).toThrow(/not a member/);
    const reply = groups.createReply({ uid: "o", group, member: owner, post, body: "Because it slows down", replyId: "r1", clock: at() });
    expect(find(reply.writes, "groupPosts/p1")).toMatchObject({ replyCount: 1 });
    expect(() => groups.createReply({ uid: "o", group, member: owner, post: { ...post, hidden: true }, body: "x", replyId: "r2", clock: at() })).toThrow(/not found/);
  });
  it("reactions toggle one per student and helpful marks exclude the author", () => {
    const first = groups.reactToPost({ uid: "o", group, member: owner, post, existing: null, emoji: "💡", clock: at() });
    expect(first.result).toEqual({ reactions: { "💡": 1 }, mine: "💡" });
    const existing = find(first.writes, "groupPostReactions/p1_o") as never;
    const switched = groups.reactToPost({ uid: "o", group, member: owner, post: { ...post, reactions: { "💡": 1 } }, existing, emoji: "👍", clock: at() });
    expect(switched.result.reactions).toEqual({ "💡": 0, "👍": 1 });
    const cleared = groups.reactToPost({ uid: "o", group, member: owner, post: { ...post, reactions: { "💡": 1 } }, existing, emoji: "💡", clock: at() });
    expect(cleared.result).toMatchObject({ mine: null, reactions: { "💡": 0 } });
    expect(() => groups.reactToPost({ uid: "o", group, member: owner, post, existing: null, emoji: "💩", clock: at() })).toThrow(/Unknown reaction/);
    expect(() => groups.markHelpful({ uid: "m", group, member: member("m"), target: post, targetType: "post" })).toThrow(/your own/);
    expect(groups.markHelpful({ uid: "o", group, member: owner, target: post, targetType: "post" }).result).toEqual({ helpfulCount: 1, marked: true });
  });
  it("only staff hide content; any member can report", () => {
    expect(() => groups.moderate({ uid: "m", group, member: member("m"), targetType: "post", target: post, hidden: true })).toThrow(/owner or an admin/);
    expect(find(groups.moderate({ uid: "o", group, member: owner, targetType: "post", target: post, hidden: true }), "groupPosts/p1")).toMatchObject({ hidden: true });
    const { writes } = groups.reportInGroup({ uid: "m", group, member: member("m"), targetType: "post", targetId: "p1", reason: "contact_sharing", details: "shared a number", reportId: "rep1", clock: at() });
    expect(find(writes, "groupReports/rep1")).toMatchObject({ status: "open", groupId: "g1" });
  });
});

describe("group sessions and challenges", () => {
  it("runs the shared room for a group and credits each present member on stop", () => {
    const start = applyRoomAction({ uid: "o", session: { status: "idle", startedAt: null, resumedAt: null, accumulatedSec: 0, participants: {}, startedBy: null, updatedAt: null }, action: "start", livePath: "groupSessions/g1_live", historyPath: "groupSessions/g1_h1", historyExtra: { groupId: "g1" }, kind: "group", contexts: new Map(), clock: at() });
    const session = find(start.writes, "groupSessions/g1_live") as never;
    const stop = applyRoomAction({ uid: "o", session, action: "stop", livePath: "groupSessions/g1_live", historyPath: "groupSessions/g1_h1", historyExtra: { groupId: "g1" }, kind: "group", contexts: new Map([["o", ctx("o")]]), clock: at(T0 + 30 * 60_000) });
    expect(stop.result.credited.o.minutes).toBe(30);
    expect(find(stop.writes, "learningSessions/session_o_group-g1_h1")).toMatchObject({ kind: "group", minutes: 30 });
    expect(find(stop.writes, "groupSessions/g1_h1")).toMatchObject({ groupId: "g1" });
  });
  it("tracks a group total and pays every contributing member once", () => {
    const { writes } = groups.createGroupChallenge({ uid: "o", group, member: owner, kind: "questions", target: 10, days: 14, challengeId: "c1", clock: at() });
    const challenge = find(writes, "groupChallenges/c1") as never as Parameters<typeof groups.refreshGroupChallenge>[0]["challenge"];
    expect(challenge).toMatchObject({ title: "Complete 10 questions together", totalProgress: 0 });
    expect(() => groups.createGroupChallenge({ uid: "m", group, member: member("m"), kind: "questions", target: 10, days: 14, challengeId: "c2", clock: at() })).toThrow(/owner or an admin/);
    const partial = groups.refreshGroupChallenge({ uid: "m", group, member: member("m"), challenge, counts: { o: 4, m: 3 }, contexts: new Map(), clock: at(T0 + 1) });
    expect(partial.result).toMatchObject({ totalProgress: 7, completed: false });
    const done = groups.refreshGroupChallenge({ uid: "m", group, member: member("m"), challenge, counts: { o: 6, m: 5, z: 0 }, contexts: new Map([["o", ctx("o")], ["m", ctx("m")], ["z", ctx("z")]]), clock: at(T0 + 2) });
    expect(done.result).toMatchObject({ totalProgress: 10, completed: true, rewarded: ["o", "m"] });
    expect(find(done.writes, "users/m")).toMatchObject({ xp: 150, coins: 20 });
    const again = groups.refreshGroupChallenge({ uid: "m", group, member: member("m"), challenge: { ...challenge, completed: true, rewardedUids: ["o", "m"] }, counts: { o: 6, m: 5 }, contexts: new Map([["o", ctx("o")], ["m", ctx("m")]]), clock: at(T0 + 3) });
    expect(again.result.rewarded).toEqual([]);
  });
});
