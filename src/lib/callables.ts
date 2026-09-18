import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { AiMode, AiSource, ChallengeKind, SessionKind, Strength, SubmittedAnswer } from "./types";
import type { StartResult, SubmitResult } from "../../functions/src/lib/assessments.js";
import type { RankedCandidate, RoomAction, RoomResult } from "../../functions/src/lib/buddy.js";
import type { OutcomeResult } from "../../functions/src/lib/outcome.js";

export type { OutcomeResult, StartResult as AssessmentStartResult, SubmitResult as AssessmentSubmitResult, RankedCandidate, RoomAction, RoomResult };

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
