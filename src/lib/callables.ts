import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { AiMode, AiSource, ChallengeKind, GroupRole, ReportReason, SessionKind, Strength, SubmittedAnswer } from "./types";
import type { StartResult, SubmitResult } from "../../functions/src/lib/assessments.js";
import type { RankedCandidate, RoomAction, RoomResult } from "../../functions/src/lib/buddy.js";
import type { GroupInput } from "../../functions/src/lib/groups.js";
import type { OutcomeResult } from "../../functions/src/lib/outcome.js";

export type { OutcomeResult, StartResult as AssessmentStartResult, SubmitResult as AssessmentSubmitResult, RankedCandidate, RoomAction, RoomResult, GroupInput };

function call<Input, Output>(name: string) {
  const callable = httpsCallable<Input, Output>(functions, name);
  return async (input: Input): Promise<Output> => (await callable(input)).data;
}

export interface SubmitAnswerResponse {
  alreadySubmitted: boolean;
  correct: boolean;
  correctIndexes: number[];
  numericAnswer: number | null;
  explanation: string;
  rewarded: boolean;
  mastery: number;
  strength: Strength;
  rewards: OutcomeResult | null;
}

export const api = {
  startLesson: call<{ lessonId: string }, { status: "started" | "completed" }>("startLesson"),
  completeLesson: call<{ lessonId: string }, { alreadyCompleted: boolean; chapterCompleted: boolean; rewards: OutcomeResult | null }>("completeLesson"),
  submitAnswer: call<{ attemptId: string; questionId: string; answer: SubmittedAnswer; timeTakenSec: number; context: "practice" | "topic" }, SubmitAnswerResponse>("submitAnswer"),
  recordStudySession: call<{ sessionId: string; topicId: string | null; minutes: number; kind: SessionKind }, { alreadyRecorded: boolean; minutesCounted: number; rewards: OutcomeResult | null }>("recordStudySession"),
  spinWheel: call<Record<string, never>, { result: string; xp: number; coins: number; streakProtection: number; nextSpinAt: number; rewards: OutcomeResult }>("spinWheel"),
  redeemReward: call<{ rewardId: string; redemptionKey: string }, { alreadyRedeemed: boolean; redemptionId: string; coinsSpent: number; remainingCoins: number }>("redeemReward"),
  startAssessment: call<{ assessmentId: string; scopeId?: string | null }, StartResult>("startAssessment"),
  submitAssessment: call<{ attemptId: string; answers: Record<string, SubmittedAnswer>; timeTakenSec: number }, SubmitResult>("submitAssessment"),
  findBuddyCandidates: call<Record<string, never>, { candidates: RankedCandidate[] }>("findBuddyCandidates"),
  sendBuddyRequest: call<{ toUid: string; message: string }, { requestId: string }>("sendBuddyRequest"),
  respondBuddyRequest: call<{ requestId: string; accept: boolean }, { status: "accepted" | "declined"; pairId: string | null }>("respondBuddyRequest"),
  cancelBuddyRequest: call<{ requestId: string }, { cancelled: boolean }>("cancelBuddyRequest"),
  unmatchBuddy: call<Record<string, never>, { ended: boolean }>("unmatchBuddy"),
  buddyRoomAction: call<{ action: RoomAction }, RoomResult>("buddyRoomAction"),
  createBuddyChallenge: call<{ kind: ChallengeKind; target: number; days: number }, { challengeId: string }>("createBuddyChallenge"),
  refreshBuddyChallenge: call<{ challengeId: string }, { progress: Record<string, number>; completed: boolean; rewarded: string[] }>("refreshBuddyChallenge"),
  createGroup: call<GroupInput, { groupId: string }>("createGroup"),
  updateGroup: call<GroupInput & { groupId: string; resources?: { title: string; url: string }[] }, { updated: boolean }>("updateGroup"),
  requestJoinGroup: call<{ groupId: string; message: string }, { requestId: string }>("requestJoinGroup"),
  respondJoinRequest: call<{ requestId: string; approve: boolean }, { status: "approved" | "rejected" }>("respondJoinRequest"),
  createGroupInviteCode: call<{ groupId: string; expiresInHours: number; maxUses: number }, { code: string; expiresAt: number }>("createGroupInviteCode"),
  revokeGroupInviteCode: call<{ code: string }, { revoked: boolean }>("revokeGroupInviteCode"),
  joinGroupWithCode: call<{ code: string }, { groupId: string; alreadyMember: boolean }>("joinGroupWithCode"),
  inviteToGroup: call<{ groupId: string; anonUsername: string }, { invitationId: string }>("inviteToGroup"),
  respondGroupInvitation: call<{ invitationId: string; accept: boolean }, { status: "accepted" | "declined"; groupId: string }>("respondGroupInvitation"),
  leaveGroup: call<{ groupId: string }, { archived: boolean; newOwner: string | null }>("leaveGroup"),
  removeGroupMember: call<{ groupId: string; targetUid: string }, { removed: boolean }>("removeGroupMember"),
  setGroupRole: call<{ groupId: string; targetUid: string; role: GroupRole }, { updated: boolean }>("setGroupRole"),
  createGroupPost: call<{ groupId: string; kind: "post" | "question" | "announcement"; title: string; body: string }, { postId: string }>("createGroupPost"),
  createGroupReply: call<{ postId: string; body: string }, { replyId: string }>("createGroupReply"),
  reactToGroupPost: call<{ postId: string; emoji: string }, { reactions: Record<string, number>; mine: string | null }>("reactToGroupPost"),
  markGroupHelpful: call<{ targetType: "post" | "reply"; targetId: string }, { helpfulCount: number; marked: boolean }>("markGroupHelpful"),
  moderateGroupContent: call<{ targetType: "post" | "reply"; targetId: string; hidden: boolean }, { hidden: boolean }>("moderateGroupContent"),
  reportInGroup: call<{ groupId: string; targetType: "post" | "reply" | "member"; targetId: string; reason: ReportReason; details: string }, { reportId: string }>("reportInGroup"),
  groupSessionAction: call<{ groupId: string; action: RoomAction }, RoomResult>("groupSessionAction"),
  createGroupChallenge: call<{ groupId: string; kind: ChallengeKind; target: number; days: number }, { challengeId: string }>("createGroupChallenge"),
  refreshGroupChallenge: call<{ challengeId: string }, { progress: Record<string, number>; totalProgress: number; completed: boolean; rewarded: string[] }>("refreshGroupChallenge"),
  askAi: call<
    { conversationId: string; mode: AiMode; message?: string; beginner?: boolean; topicId?: string | null; chapterId?: string | null; questionId?: string | null; attemptAnswer?: string },
    { text: string; source: AiSource; notice: string | null; remaining: number }
  >("askAi"),
  deleteAccount: call<Record<string, never>, { deleted: boolean }>("deleteAccount")
};

/** Human-readable message from a Functions or Firestore error. Never exposes internals. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: string; message?: string };
    if (code === "permission-denied" || code === "functions/permission-denied") return "You do not have permission to do that.";
    if (code === "unauthenticated" || code === "functions/unauthenticated") return "Please sign in again.";
    if (code === "functions/unavailable" || code === "unavailable") return message || "Service temporarily unavailable.";
    if (code === "functions/resource-exhausted") return message || "You are doing that too often. Please wait a bit.";
    if (code === "auth/network-request-failed" || code === "functions/internal" && message?.includes("fetch")) return "Network problem. Check your connection and try again.";
    if (message && !message.includes("INTERNAL") && !message.includes("undefined")) return message;
  }
  return fallback;
}
