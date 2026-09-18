// Browser-side versions of the Cloud Functions, run against the demo store. All grading, reward,
// streak and mastery logic is the same code the server runs (functions/src/lib), so the demo
// behaves like production minus the network.
import type {
  AssessmentAttemptDoc, AssessmentDoc, AiMessageDoc, AiMode, BuddyChallengeDoc, BuddyPairDoc, BuddyPreferencesDoc, BuddyRequestDoc, BuddySessionDoc, ChallengeKind, ChapterDoc,
  GroupChallengeDoc, GroupDoc, GroupInvitationDoc, GroupInviteCodeDoc, GroupJoinRequestDoc, GroupMemberDoc, GroupPostDoc, GroupPostReactionDoc, GroupReplyDoc, GroupRole, GroupSessionDoc, ReportReason, LessonDoc, LessonProgressDoc, ChapterProgressDoc, PublicProfile, QuestionDoc, QuestionKeyDoc, RedemptionDoc, RewardDoc,
  SpinStateDoc, TopicDoc, TopicMasteryDoc, UserDoc
} from "../lib/types";
import { applyWrites } from "../../functions/src/lib/writes.js";
import { toMillis } from "../../functions/src/lib/outcome.js";
import { completeLesson, LogicError, recordSession, SESSION_KINDS, submitAnswer } from "../../functions/src/lib/learning.js";
import { claimProgram, redeem, spin, type ProgramId } from "../../functions/src/lib/rewards.js";
import { PERIODIC_KINDS, periodKeyFor, startAttempt, submitAttempt } from "../../functions/src/lib/assessments.js";
import { cancelRequest, countActivity, createChallenge, rankCandidates, refreshChallenge, respondRequest, roomAction, sendRequest, sessionDoc, unmatch, type RoomAction } from "../../functions/src/lib/buddy.js";
import * as groups from "../../functions/src/lib/groups.js";
import { applyRoomAction, ROOM_ACTIONS, stopEventId } from "../../functions/src/lib/room.js";
import { inviteCode } from "./hash";
import type { OutcomeContext } from "../../functions/src/lib/outcome.js";
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

function activePair(uid: string): BuddyPairDoc | null {
  const rows = runQuery({ path: "buddies", filters: [{ field: "members", op: "array-contains", value: uid }, { field: "status", op: "==", value: "active" }], orders: [], max: 1 });
  return rows.length ? (rows[0].data as unknown as BuddyPairDoc) : null;
}
function applyOrThrow(writes: Parameters<typeof applyWrites>[1]): void {
  applyWrites(storeSink, writes);
}
function logicGuard<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof LogicError) throw new DemoError(error.code, error.message);
    throw error;
  }
}
function memberDocs(uid: string, kind: ChallengeKind) {
  const rows = (path: string) => runQuery({ path, filters: [{ field: "userId", op: "==", value: uid }], orders: [], max: null }).map((row) => row.data as never);
  return { learningSessions: kind === "study_minutes" ? rows("learningSessions") : [], questionAttempts: kind === "questions" ? rows("questionAttempts") : [], chapterProgress: kind === "chapter" ? rows("chapterProgress") : [], assessmentAttempts: kind === "assessment" ? rows("assessmentAttempts") : [] };
}

function groupContext(uid: string, groupId: string): { group: GroupDoc | null; member: GroupMemberDoc | null } {
  return { group: getDoc<GroupDoc>(`groups/${groupId}`), member: getDoc<GroupMemberDoc>(`groupMembers/${groupId}_${uid}`) };
}
function requireProfile(uid: string): PublicProfile {
  return requireDoc<PublicProfile>(`publicProfiles/${uid}`, "Profile not found.", "failed-precondition");
}
function firstWhere<T>(path: string, filters: { field: string; op: string; value: unknown }[]): T | null {
  const rows = runQuery({ path, filters, orders: [], max: 1 });
  return rows.length ? (rows[0].data as unknown as T) : null;
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

  async claimProgramReward(uid, input) {
    const program = requireString(input.program, "program", 20) as ProgramId;
    if (program !== "goodie" && program !== "ninety_day") throw new DemoError("invalid-argument", "Unknown program.");
    const redemptionId = `${uid}_program_${program}`;
    return run(uid, `claim_${redemptionId}`, (ctx, clock) => claimProgram({ ctx, clock, program, existing: getDoc<RedemptionDoc>(`redemptions/${redemptionId}`), streakCurrent: ctx.streak.current }));
  },

  async startAssessment(uid, input) {
    const assessmentId = requireString(input.assessmentId, "assessmentId", 60);
    const scopeId = typeof input.scopeId === "string" ? input.scopeId : null;
    const template = requireDoc<AssessmentDoc>(`assessments/${assessmentId}`, "Assessment not found.");
    const user = requireDoc<UserDoc>(`users/${uid}`, "Profile not found.", "failed-precondition");
    const clock = demoClock();
    const periodKey = periodKeyFor(template.kind, clock.today);
    const attemptId = PERIODIC_KINDS.includes(template.kind) ? `${uid}_${template.id}_${periodKey}` : `${uid}_${template.id}_${newDocId()}`;
    const existing = PERIODIC_KINDS.includes(template.kind) ? getDoc<AssessmentAttemptDoc>(`assessmentAttempts/${attemptId}`) : null;
    let filters: { field: string; op: string; value: unknown }[] = [];
    if (template.kind === "topic_test") {
      if (!scopeId) throw new DemoError("invalid-argument", "A topic is required.");
      filters = [{ field: "topicId", op: "==", value: scopeId }];
    } else if (template.kind === "chapter_test") {
      if (!scopeId) throw new DemoError("invalid-argument", "A chapter is required.");
      filters = [{ field: "chapterId", op: "==", value: scopeId }];
    } else if (template.examTag) {
      filters = [{ field: "examTags", op: "array-contains", value: template.examTag }, { field: "subjectId", op: "in", value: template.subjectIds }];
    } else {
      filters = [{ field: "classLevel", op: "==", value: user.classLevel }, { field: "subjectId", op: "in", value: user.subjects }];
    }
    const pool = existing ? [] : runQuery({ path: "questions", filters, orders: [], max: 300 }).map((row) => row.data as unknown as QuestionDoc);
    try {
      const { writes, result } = startAttempt({ uid, template, scopeId, pool, existing, attemptId, clock });
      applyWrites(storeSink, writes);
      return result;
    } catch (error) {
      if (error instanceof LogicError) throw new DemoError(error.code, error.message);
      throw error;
    }
  },

  async submitAssessment(uid, input) {
    const attemptId = requireString(input.attemptId, "attemptId", 160);
    const timeTakenSec = requireNumber(input.timeTakenSec ?? 0, "timeTakenSec", 0, 36_000);
    const rawAnswers = typeof input.answers === "object" && input.answers !== null ? (input.answers as Record<string, unknown>) : {};
    const attempt = requireDoc<AssessmentAttemptDoc>(`assessmentAttempts/${attemptId}`, "Assessment attempt not found.");
    if (attempt.userId !== uid) throw new DemoError("permission-denied", "Not your assessment.");
    const questions = attempt.questionIds.map((id) => getDoc<QuestionDoc>(`questions/${id}`)).filter((row): row is QuestionDoc => Boolean(row));
    const keys = attempt.questionIds.map((id) => getDoc<QuestionKeyDoc>(`questionKeys/${id}`)).filter((row): row is QuestionKeyDoc => Boolean(row));
    const topicIds = [...new Set(questions.map((question) => question.topicId))];
    const mastery = new Map(topicIds.map((topicId) => [topicId, getDoc<TopicMasteryDoc>(`topicMastery/${uid}_${topicId}`)]));
    const poolSizes = new Map(topicIds.map((topicId) => [topicId, count("questions", "topicId", topicId)]));
    return run(uid, `assessment_${attemptId}`, (ctx, clock) => submitAttempt({ ctx, clock, attempt, questions, keys, rawAnswers, timeTakenSec, mastery, poolSizes }));
  },

  async findBuddyCandidates(uid) {
    const me = { profile: requireDoc<PublicProfile>(`publicProfiles/${uid}`, "Profile not found.", "failed-precondition"), prefs: getDoc<BuddyPreferencesDoc>(`buddyPreferences/${uid}`) };
    const blocked = new Set<string>(listDocs(`blocks/${uid}/users`).map((row) => row.id));
    const open = runQuery({ path: "buddyPreferences", filters: [{ field: "open", op: "==", value: true }], orders: [], max: 200 });
    const candidates = open.map((row) => ({ profile: getDoc<PublicProfile>(`publicProfiles/${row.id}`), prefs: row.data as unknown as BuddyPreferencesDoc })).filter((row): row is { profile: PublicProfile; prefs: BuddyPreferencesDoc } => Boolean(row.profile));
    for (const candidate of candidates) if (getDoc(`blocks/${candidate.profile.uid}/users/${uid}`)) blocked.add(candidate.profile.uid);
    return { candidates: rankCandidates(me, candidates, blocked) };
  },

  async sendBuddyRequest(uid, input) {
    const toUid = requireString(input.toUid, "toUid", 128);
    const message = typeof input.message === "string" ? input.message : "";
    const fromProfile = requireDoc<PublicProfile>(`publicProfiles/${uid}`, "Profile not found.");
    const toProfile = requireDoc<PublicProfile>(`publicProfiles/${toUid}`, "Student not found.");
    const pending = runQuery({ path: "buddyRequests", filters: [{ field: "status", op: "==", value: "pending" }], orders: [], max: null }).map((row) => row.data as unknown as BuddyRequestDoc);
    const existing = pending.find((row) => (row.fromUid === uid && row.toUid === toUid) || (row.fromUid === toUid && row.toUid === uid)) ?? null;
    const requestId = newDocId();
    return logicGuard(() => {
      const { writes, result } = sendRequest({
        fromUid: uid, toUid, message, requestId, blockedEitherWay: Boolean(getDoc(`blocks/${uid}/users/${toUid}`) || getDoc(`blocks/${toUid}/users/${uid}`)),
        fromProfile, toProfile, toPrefsOpen: getDoc<BuddyPreferencesDoc>(`buddyPreferences/${toUid}`)?.open === true, existingBetween: existing,
        recipientNotify: getDoc<UserDoc>(`users/${toUid}`)?.notificationPrefs?.buddy !== false, clock: demoClock()
      });
      applyOrThrow(writes);
      return result;
    });
  },

  async respondBuddyRequest(uid, input) {
    const requestId = requireString(input.requestId, "requestId", 80);
    const request = requireDoc<BuddyRequestDoc>(`buddyRequests/${requestId}`, "Request not found.");
    return logicGuard(() => {
      const { writes, result } = respondRequest({ uid, request, accept: input.accept === true, fromProfile: requireDoc<PublicProfile>(`publicProfiles/${request.fromUid}`, "Profile not found."), toProfile: requireDoc<PublicProfile>(`publicProfiles/${request.toUid}`, "Profile not found."), pairId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },

  async cancelBuddyRequest(uid, input) {
    const requestId = requireString(input.requestId, "requestId", 80);
    const request = requireDoc<BuddyRequestDoc>(`buddyRequests/${requestId}`, "Request not found.");
    logicGuard(() => applyOrThrow(cancelRequest(uid, request, demoClock())));
    return { cancelled: true };
  },

  async unmatchBuddy(uid) {
    logicGuard(() => applyOrThrow(unmatch(uid, activePair(uid), demoClock())));
    return { ended: true };
  },

  async buddyRoomAction(uid, input) {
    const action = requireString(input.action, "action", 10) as RoomAction;
    const pair = activePair(uid);
    if (!pair) throw new DemoError("failed-precondition", "You do not have a Buddy yet.");
    const clock = demoClock();
    const historyId = `${pair.id}_${newDocId()}`;
    const session = sessionDoc(getDoc<BuddySessionDoc>(`buddySessions/${pair.id}_live`), pair.id, pair.members);
    const contexts = new Map<string, OutcomeContext>();
    if (action === "stop") for (const member of pair.members) contexts.set(member, contextFrom(readDoc, member, `session_${member}_buddy-${historyId}`, clock));
    return logicGuard(() => {
      const { writes, result } = roomAction({ uid, pair, session, action, contexts, historyId, clock });
      applyOrThrow(writes);
      return result;
    });
  },

  async createBuddyChallenge(uid, input) {
    const kind = requireString(input.kind, "kind", 20) as ChallengeKind;
    const target = requireNumber(input.target, "target", 1, 10_000);
    const days = requireNumber(input.days ?? 7, "days", 1, 30);
    return logicGuard(() => {
      const { writes, result } = createChallenge({ uid, pair: activePair(uid), kind, target, days, challengeId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },

  async refreshBuddyChallenge(uid, input) {
    const challengeId = requireString(input.challengeId, "challengeId", 80);
    const challenge = requireDoc<BuddyChallengeDoc>(`buddyChallenges/${challengeId}`, "Challenge not found.");
    if (!challenge.members.includes(uid)) throw new DemoError("permission-denied", "You are not in this challenge.");
    const clock = demoClock();
    const sinceMs = toMillis(challenge.startsAt) ?? 0;
    const counts: Record<string, number> = {};
    const contexts = new Map<string, OutcomeContext>();
    for (const member of challenge.members) {
      counts[member] = countActivity(challenge.kind, memberDocs(member, challenge.kind), sinceMs);
      contexts.set(member, contextFrom(readDoc, member, `challenge_${challenge.id}_${member}`, clock));
    }
    return logicGuard(() => {
      const { writes, result } = refreshChallenge({ uid, challenge, counts, contexts, clock });
      applyOrThrow(writes);
      return result;
    });
  },

  async createGroup(uid, input) {
    return logicGuard(() => {
      const { writes, result } = groups.createGroup({ uid, profile: requireProfile(uid), groupId: newDocId(), fields: groups.validateGroupInput(input), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async updateGroup(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      applyOrThrow(groups.updateGroup({ uid, ...groupContext(uid, groupId), fields: groups.validateGroupInput(input), resources: Array.isArray(input.resources) ? (input.resources as { title: string; url: string }[]) : null, clock: demoClock() }));
      return { updated: true };
    });
  },
  async requestJoinGroup(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      const pending = firstWhere<GroupJoinRequestDoc>("groupJoinRequests", [{ field: "groupId", op: "==", value: groupId }, { field: "uid", op: "==", value: uid }, { field: "status", op: "==", value: "pending" }]);
      const { writes, result } = groups.requestJoin({ uid, ...groupContext(uid, groupId), pending, message: typeof input.message === "string" ? input.message : "", requestId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async respondJoinRequest(uid, input) {
    const requestId = requireString(input.requestId, "requestId", 80);
    const request = requireDoc<GroupJoinRequestDoc>(`groupJoinRequests/${requestId}`, "Request not found.");
    return logicGuard(() => {
      const { writes, result } = groups.respondJoinRequest({ uid, ...groupContext(uid, request.groupId), request, approve: input.approve === true, requesterProfile: getDoc<PublicProfile>(`publicProfiles/${request.uid}`), requesterMember: getDoc<GroupMemberDoc>(`groupMembers/${request.groupId}_${request.uid}`), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async createGroupInviteCode(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      let code = inviteCode();
      while (getDoc(`groupInviteCodes/${code}`)) code = inviteCode();
      const { writes, result } = groups.createInviteCode({ uid, ...groupContext(uid, groupId), code, expiresInHours: requireNumber(input.expiresInHours ?? 72, "expiresInHours", 1, 720), maxUses: requireNumber(input.maxUses ?? 10, "maxUses", 1, 100), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async revokeGroupInviteCode(uid, input) {
    const code = requireString(input.code, "code", 12).toUpperCase();
    const codeDoc = requireDoc<GroupInviteCodeDoc>(`groupInviteCodes/${code}`, "Code not found.");
    logicGuard(() => applyOrThrow(groups.revokeInviteCode({ uid, ...groupContext(uid, codeDoc.groupId), code: codeDoc, clock: demoClock() })));
    return { revoked: true };
  },
  async joinGroupWithCode(uid, input) {
    const code = requireString(input.code, "code", 12).toUpperCase().trim();
    return logicGuard(() => {
      const codeDoc = getDoc<GroupInviteCodeDoc>(`groupInviteCodes/${code}`);
      const ctx = codeDoc ? groupContext(uid, codeDoc.groupId) : { group: null, member: null };
      const { writes, result } = groups.joinWithCode({ uid, profile: requireProfile(uid), code: codeDoc, ...ctx, clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async inviteToGroup(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    const anonUsername = requireString(input.anonUsername, "anonUsername", 40);
    return logicGuard(() => {
      const toProfile = firstWhere<PublicProfile>("publicProfiles", [{ field: "anonUsername", op: "==", value: anonUsername }]);
      const { writes, result } = groups.invite({ uid, ...groupContext(uid, groupId), toProfile, toMember: toProfile ? getDoc<GroupMemberDoc>(`groupMembers/${groupId}_${toProfile.uid}`) : null, pending: toProfile ? firstWhere<GroupInvitationDoc>("groupInvitations", [{ field: "groupId", op: "==", value: groupId }, { field: "toUid", op: "==", value: toProfile.uid }, { field: "status", op: "==", value: "pending" }]) : null, invitationId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async respondGroupInvitation(uid, input) {
    const invitationId = requireString(input.invitationId, "invitationId", 80);
    const invitation = requireDoc<GroupInvitationDoc>(`groupInvitations/${invitationId}`, "Invitation not found.");
    return logicGuard(() => {
      const { writes, result } = groups.respondInvitation({ uid, profile: requireProfile(uid), invitation, accept: input.accept === true, ...groupContext(uid, invitation.groupId), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async leaveGroup(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      const others = runQuery({ path: "groupMembers", filters: [{ field: "groupId", op: "==", value: groupId }], orders: [], max: null }).map((row) => row.data as unknown as GroupMemberDoc).filter((member) => member.uid !== uid);
      const { writes, result } = groups.leaveGroup({ uid, ...groupContext(uid, groupId), others, clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async removeGroupMember(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    const targetUid = requireString(input.targetUid, "targetUid", 128);
    logicGuard(() => applyOrThrow(groups.removeMember({ uid, ...groupContext(uid, groupId), target: getDoc<GroupMemberDoc>(`groupMembers/${groupId}_${targetUid}`), clock: demoClock() })));
    return { removed: true };
  },
  async setGroupRole(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    const targetUid = requireString(input.targetUid, "targetUid", 128);
    logicGuard(() => applyOrThrow(groups.setRole({ uid, ...groupContext(uid, groupId), target: getDoc<GroupMemberDoc>(`groupMembers/${groupId}_${targetUid}`), role: requireString(input.role, "role", 10) as GroupRole, clock: demoClock() })));
    return { updated: true };
  },
  async createGroupPost(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      const { writes, result } = groups.createPost({ uid, ...groupContext(uid, groupId), kind: (input.kind as GroupPostDoc["kind"]) ?? "post", title: String(input.title ?? ""), body: String(input.body ?? ""), postId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async createGroupReply(uid, input) {
    const postId = requireString(input.postId, "postId", 80);
    const post = requireDoc<GroupPostDoc>(`groupPosts/${postId}`, "Post not found.");
    return logicGuard(() => {
      const { writes, result } = groups.createReply({ uid, ...groupContext(uid, post.groupId), post, body: String(input.body ?? ""), replyId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async reactToGroupPost(uid, input) {
    const postId = requireString(input.postId, "postId", 80);
    const post = requireDoc<GroupPostDoc>(`groupPosts/${postId}`, "Post not found.");
    return logicGuard(() => {
      const { writes, result } = groups.reactToPost({ uid, ...groupContext(uid, post.groupId), post, existing: getDoc<GroupPostReactionDoc>(`groupPostReactions/${postId}_${uid}`), emoji: requireString(input.emoji, "emoji", 4), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async markGroupHelpful(uid, input) {
    const targetType = input.targetType === "reply" ? "reply" : "post";
    const targetId = requireString(input.targetId, "targetId", 80);
    const target = requireDoc<GroupPostDoc | GroupReplyDoc>(`${targetType === "post" ? "groupPosts" : "groupReplies"}/${targetId}`, "Not found.");
    return logicGuard(() => {
      const { writes, result } = groups.markHelpful({ uid, ...groupContext(uid, target.groupId), target, targetType });
      applyOrThrow(writes);
      return result;
    });
  },
  async moderateGroupContent(uid, input) {
    const targetType = input.targetType === "reply" ? "reply" : "post";
    const targetId = requireString(input.targetId, "targetId", 80);
    const target = requireDoc<GroupPostDoc | GroupReplyDoc>(`${targetType === "post" ? "groupPosts" : "groupReplies"}/${targetId}`, "Not found.");
    logicGuard(() => applyOrThrow(groups.moderate({ uid, ...groupContext(uid, target.groupId), targetType, target, hidden: input.hidden === true })));
    return { hidden: input.hidden === true };
  },
  async reportInGroup(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      const { writes, result } = groups.reportInGroup({ uid, ...groupContext(uid, groupId), targetType: input.targetType as "post" | "reply" | "member", targetId: String(input.targetId ?? ""), reason: input.reason as ReportReason, details: String(input.details ?? ""), reportId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async groupSessionAction(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    const action = requireString(input.action, "action", 10) as RoomAction;
    if (!ROOM_ACTIONS.includes(action)) throw new DemoError("invalid-argument", "Unknown room action.");
    const clock = demoClock();
    const historyId = `${groupId}_${newDocId()}`;
    return logicGuard(() => {
      groups.requireGroupMember(uid, ...Object.values(groupContext(uid, groupId)) as [GroupDoc | null, GroupMemberDoc | null]);
      const session = getDoc<GroupSessionDoc>(`groupSessions/${groupId}_live`) ?? { status: "idle" as const, startedAt: null, resumedAt: null, accumulatedSec: 0, participants: {}, startedBy: null, updatedAt: null };
      const contexts = new Map<string, OutcomeContext>();
      if (action === "stop") for (const participant of Object.keys(session.participants)) contexts.set(participant, contextFrom(readDoc, participant, stopEventId(participant, "group", historyId), clock));
      const { writes, result } = applyRoomAction({ uid, session, action, livePath: `groupSessions/${groupId}_live`, historyPath: `groupSessions/${historyId}`, historyExtra: { groupId }, kind: "group", contexts, clock });
      applyOrThrow(writes);
      return result;
    });
  },
  async createGroupChallenge(uid, input) {
    const groupId = requireString(input.groupId, "groupId", 80);
    return logicGuard(() => {
      const { writes, result } = groups.createGroupChallenge({ uid, ...groupContext(uid, groupId), kind: requireString(input.kind, "kind", 20) as ChallengeKind, target: requireNumber(input.target, "target", 1, 100_000), days: requireNumber(input.days ?? 14, "days", 1, 30), challengeId: newDocId(), clock: demoClock() });
      applyOrThrow(writes);
      return result;
    });
  },
  async refreshGroupChallenge(uid, input) {
    const challengeId = requireString(input.challengeId, "challengeId", 80);
    const challenge = requireDoc<GroupChallengeDoc>(`groupChallenges/${challengeId}`, "Challenge not found.");
    const clock = demoClock();
    const sinceMs = toMillis(challenge.startsAt) ?? 0;
    const memberUids = runQuery({ path: "groupMembers", filters: [{ field: "groupId", op: "==", value: challenge.groupId }], orders: [], max: null }).map((row) => (row.data as unknown as GroupMemberDoc).uid);
    const counts: Record<string, number> = {};
    const contexts = new Map<string, OutcomeContext>();
    for (const member of memberUids) {
      counts[member] = countActivity(challenge.kind, memberDocs(member, challenge.kind), sinceMs);
      contexts.set(member, contextFrom(readDoc, member, `challenge_${challenge.id}_${member}`, clock));
    }
    return logicGuard(() => {
      const { writes, result } = groups.refreshGroupChallenge({ uid, ...groupContext(uid, challenge.groupId), challenge, counts, contexts, clock });
      applyOrThrow(writes);
      return result;
    });
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
