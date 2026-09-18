// Pure Buddy logic: matching, requests, pairs, the shared study room and pair challenges.
// Nothing here exposes a name, email, phone or location: candidates are described by
// publicProfiles only, and every action re-checks membership and blocks.
import { computeOutcome, notificationOp, toMillis, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { LogicError } from "./learning.js";
import { contactSharingMessage, findContactSharing } from "./safety.js";
import type { Clock, WriteOp } from "./writes.js";
import type { BuddyChallengeDoc, BuddyPairDoc, BuddyPreferencesDoc, BuddyRequestDoc, BuddySessionDoc, ChallengeKind, PublicProfile, SharedSessionState } from "../types.js";

export interface Candidate {
  profile: PublicProfile;
  prefs: BuddyPreferencesDoc | null;
}

export interface RankedCandidate {
  uid: string;
  anonUsername: string;
  avatar: string;
  classLevel: number;
  goal: string;
  subjects: string[];
  learningLevel: string;
  language: string;
  schedule: string | null;
  score: number;
  reasons: string[];
}

/** Same class is required. Goal, shared subjects, level, language, schedule and gender preference add to the score. */
export function rankCandidates(me: Candidate, candidates: Candidate[], blocked: Set<string>): RankedCandidate[] {
  const mine = me.prefs;
  return candidates
    .filter((candidate) => candidate.profile.uid !== me.profile.uid && !blocked.has(candidate.profile.uid))
    .filter((candidate) => candidate.profile.classLevel === me.profile.classLevel)
    .filter((candidate) => candidate.prefs?.open === true && candidate.profile.buddyStatus !== "matched")
    .filter((candidate) => {
      const wantsSame = mine?.genderPreference === "same" || candidate.prefs?.genderPreference === "same";
      if (!wantsSame) return true;
      return Boolean(mine?.gender && candidate.prefs?.gender && mine.gender !== "unspecified" && mine.gender === candidate.prefs.gender);
    })
    .map((candidate) => {
      const reasons: string[] = ["Same class"];
      let score = 0;
      if (candidate.profile.goal === me.profile.goal) {
        score += 3;
        reasons.push("Same goal");
      }
      const shared = candidate.profile.subjects.filter((subject) => me.profile.subjects.includes(subject));
      score += shared.length;
      if (shared.length) reasons.push(`${shared.length} shared subject${shared.length > 1 ? "s" : ""}`);
      if (candidate.profile.learningLevel === me.profile.learningLevel) {
        score += 2;
        reasons.push("Same level");
      }
      if (candidate.profile.language === me.profile.language) {
        score += 1;
        reasons.push("Same language");
      }
      if (mine?.schedule && candidate.prefs?.schedule && (mine.schedule === candidate.prefs.schedule || mine.schedule === "flexible" || candidate.prefs.schedule === "flexible")) {
        score += 1;
        reasons.push("Schedule fits");
      }
      return {
        uid: candidate.profile.uid,
        anonUsername: candidate.profile.anonUsername,
        avatar: candidate.profile.avatar,
        classLevel: candidate.profile.classLevel,
        goal: candidate.profile.goal,
        subjects: candidate.profile.subjects,
        learningLevel: candidate.profile.learningLevel,
        language: candidate.profile.language,
        schedule: candidate.prefs?.schedule ?? null,
        score,
        reasons
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
}

export interface RequestInput {
  fromUid: string;
  toUid: string;
  message: string;
  requestId: string;
  blockedEitherWay: boolean;
  fromProfile: PublicProfile;
  toProfile: PublicProfile;
  toPrefsOpen: boolean;
  existingBetween: BuddyRequestDoc | null;
  recipientNotify: boolean;
  clock: Clock;
}

export function sendRequest(input: RequestInput): { writes: WriteOp[]; result: { requestId: string } } {
  if (input.fromUid === input.toUid) throw new LogicError("invalid-argument", "You cannot buddy yourself.");
  if (input.blockedEitherWay) throw new LogicError("permission-denied", "This student is not available.");
  if (input.fromProfile.buddyStatus === "matched") throw new LogicError("failed-precondition", "You already have a Buddy. Unmatch first.");
  if (input.toProfile.buddyStatus === "matched" || !input.toPrefsOpen) throw new LogicError("failed-precondition", "This student is not looking for a Buddy right now.");
  if (input.toProfile.classLevel !== input.fromProfile.classLevel) throw new LogicError("failed-precondition", "Buddies must be in the same class.");
  if (input.existingBetween?.status === "pending") throw new LogicError("already-exists", "A request between you two is already pending.");
  const message = input.message.trim().slice(0, 200);
  const contact = findContactSharing(message);
  if (contact) throw new LogicError("invalid-argument", contactSharingMessage(contact));
  const writes: WriteOp[] = [
    { path: `buddyRequests/${input.requestId}`, data: { id: input.requestId, fromUid: input.fromUid, toUid: input.toUid, message, status: "pending", createdAt: input.clock.stamp, respondedAt: null } }
  ];
  if (input.recipientNotify) {
    const op = notificationOp(input.toUid, { streak: true, dailyGoal: true, weakTopic: true, assessment: true, buddy: true, group: true, reward: true }, "buddy", "New Buddy request", `${input.fromProfile.anonUsername} wants to study with you.`, "/buddy", input.clock);
    if (op) writes.push(op);
  }
  return { writes, result: { requestId: input.requestId } };
}

export interface RespondInput {
  uid: string;
  request: BuddyRequestDoc;
  accept: boolean;
  fromProfile: PublicProfile;
  toProfile: PublicProfile;
  pairId: string;
  clock: Clock;
}

export function respondRequest(input: RespondInput): { writes: WriteOp[]; result: { status: "accepted" | "declined"; pairId: string | null } } {
  const { request, clock } = input;
  if (request.toUid !== input.uid) throw new LogicError("permission-denied", "Only the recipient can respond.");
  if (request.status !== "pending") throw new LogicError("failed-precondition", "This request was already answered.");
  if (!input.accept) {
    return { writes: [{ path: `buddyRequests/${request.id}`, merge: true, data: { status: "declined", respondedAt: clock.stamp } }], result: { status: "declined", pairId: null } };
  }
  if (input.fromProfile.buddyStatus === "matched" || input.toProfile.buddyStatus === "matched") throw new LogicError("failed-precondition", "One of you already has a Buddy.");
  const members = [request.fromUid, request.toUid].sort();
  const pair: BuddyPairDoc = { id: input.pairId, members, classLevel: input.toProfile.classLevel, status: "active", endedBy: null, createdAt: clock.stamp, endedAt: null };
  const writes: WriteOp[] = [
    { path: `buddyRequests/${request.id}`, merge: true, data: { status: "accepted", respondedAt: clock.stamp } },
    { path: `buddies/${input.pairId}`, data: pair as unknown as Record<string, unknown> },
    { path: `publicProfiles/${request.fromUid}`, merge: true, data: { buddyStatus: "matched", buddyPairId: input.pairId, updatedAt: clock.stamp } },
    { path: `publicProfiles/${request.toUid}`, merge: true, data: { buddyStatus: "matched", buddyPairId: input.pairId, updatedAt: clock.stamp } },
    { path: `buddySessions/${input.pairId}_live`, data: { ...emptySession(), id: `${input.pairId}_live`, pairId: input.pairId, members, finalizedAt: null } }
  ];
  const op = notificationOp(request.fromUid, { streak: true, dailyGoal: true, weakTopic: true, assessment: true, buddy: true, group: true, reward: true }, "buddy", "Buddy request accepted", `${input.toProfile.anonUsername} is now your Buddy.`, "/buddy", clock);
  if (op) writes.push(op);
  return { writes, result: { status: "accepted", pairId: input.pairId } };
}

export function cancelRequest(uid: string, request: BuddyRequestDoc, clock: Clock): WriteOp[] {
  if (request.fromUid !== uid) throw new LogicError("permission-denied", "Only the sender can cancel.");
  if (request.status !== "pending") throw new LogicError("failed-precondition", "This request was already answered.");
  return [{ path: `buddyRequests/${request.id}`, merge: true, data: { status: "cancelled", respondedAt: clock.stamp } }];
}

export function requireMember(uid: string, pair: BuddyPairDoc | null): BuddyPairDoc {
  if (!pair || !pair.members.includes(uid)) throw new LogicError("permission-denied", "You are not in this Buddy pair.");
  if (pair.status !== "active") throw new LogicError("failed-precondition", "This Buddy pair has ended.");
  return pair;
}

export function unmatch(uid: string, pair: BuddyPairDoc | null, clock: Clock): WriteOp[] {
  const active = requireMember(uid, pair);
  const writes: WriteOp[] = [{ path: `buddies/${active.id}`, merge: true, data: { status: "ended", endedBy: uid, endedAt: clock.stamp } }];
  for (const member of active.members) writes.push({ path: `publicProfiles/${member}`, merge: true, data: { buddyStatus: "none", buddyPairId: null, updatedAt: clock.stamp } });
  writes.push({ path: `buddySessions/${active.id}_live`, merge: true, data: { status: "stopped", updatedAt: clock.stamp } });
  return writes;
}

// ---------- shared study room ----------

export type RoomAction = "join" | "leave" | "start" | "pause" | "resume" | "stop" | "reset";

export function emptySession(): SharedSessionState {
  return { status: "idle", startedAt: null, resumedAt: null, accumulatedSec: 0, participants: {}, startedBy: null, updatedAt: null };
}

/** Seconds the room has been running, including the current open stretch. */
export function runningSeconds(session: SharedSessionState, nowMs: number): number {
  const resumedMs = session.status === "running" ? toMillis(session.resumedAt) : null;
  return session.accumulatedSec + (resumedMs !== null ? Math.max(0, Math.floor((nowMs - resumedMs) / 1000)) : 0);
}

function creditPresent(session: SharedSessionState, nowMs: number): SharedSessionState["participants"] {
  const resumedMs = session.status === "running" ? toMillis(session.resumedAt) : null;
  const elapsed = resumedMs !== null ? Math.max(0, Math.floor((nowMs - resumedMs) / 1000)) : 0;
  const participants: SharedSessionState["participants"] = {};
  for (const [uid, entry] of Object.entries(session.participants)) participants[uid] = { ...entry, seconds: entry.seconds + (entry.present ? elapsed : 0) };
  return participants;
}

export interface RoomInput {
  uid: string;
  pair: BuddyPairDoc | null;
  session: SharedSessionState & { id: string };
  action: RoomAction;
  /** Outcome contexts for every member present at stop time, so study minutes can be credited. */
  contexts: Map<string, OutcomeContext>;
  historyId: string;
  clock: Clock;
}

export interface RoomResult {
  status: SharedSessionState["status"];
  accumulatedSec: number;
  credited: Record<string, { minutes: number; rewards: OutcomeResult | null }>;
}

/**
 * State machine for a shared room. Every transition credits elapsed time to the participants who
 * were present, so per-student time is accurate even if one side leaves mid-session. Stop writes a
 * history document and records a "buddy" study session for each participant through the same engine
 * that caps and validates solo sessions.
 */
export function roomAction(input: RoomInput): { writes: WriteOp[]; result: RoomResult } {
  const pair = requireMember(input.uid, input.pair);
  const { clock, action } = input;
  const nowMs = clock.now.getTime();
  const session = input.session;
  const participants = creditPresent(session, nowMs);
  const accumulatedSec = runningSeconds(session, nowMs);
  const path = `${session.id.startsWith("buddySessions/") ? "" : "buddySessions/"}${session.id}`;
  const base = { participants, updatedAt: clock.stamp };
  const writes: WriteOp[] = [];
  const credited: RoomResult["credited"] = {};
  let next: Partial<SharedSessionState> = {};
  switch (action) {
    case "join":
      participants[input.uid] = participants[input.uid] ? { ...participants[input.uid], present: true } : { joinedAt: clock.stamp, seconds: 0, present: true };
      next = { resumedAt: session.status === "running" ? clock.stamp : session.resumedAt, accumulatedSec: session.status === "running" ? accumulatedSec : session.accumulatedSec };
      break;
    case "leave":
      if (participants[input.uid]) participants[input.uid] = { ...participants[input.uid], present: false };
      next = { resumedAt: session.status === "running" ? clock.stamp : session.resumedAt, accumulatedSec: session.status === "running" ? accumulatedSec : session.accumulatedSec };
      break;
    case "start":
      if (session.status === "running") throw new LogicError("failed-precondition", "The room is already running.");
      participants[input.uid] = participants[input.uid] ? { ...participants[input.uid], present: true } : { joinedAt: clock.stamp, seconds: 0, present: true };
      next = { status: "running", startedAt: session.status === "idle" || session.status === "stopped" ? clock.stamp : session.startedAt, resumedAt: clock.stamp, accumulatedSec: session.status === "paused" ? session.accumulatedSec : 0, startedBy: session.startedBy ?? input.uid };
      if (session.status === "idle" || session.status === "stopped") for (const uid of Object.keys(participants)) participants[uid] = { ...participants[uid], seconds: 0 };
      break;
    case "pause":
      if (session.status !== "running") throw new LogicError("failed-precondition", "The room is not running.");
      next = { status: "paused", resumedAt: null, accumulatedSec };
      break;
    case "resume":
      if (session.status !== "paused") throw new LogicError("failed-precondition", "The room is not paused.");
      participants[input.uid] = participants[input.uid] ? { ...participants[input.uid], present: true } : { joinedAt: clock.stamp, seconds: 0, present: true };
      next = { status: "running", resumedAt: clock.stamp };
      break;
    case "stop": {
      if (session.status !== "running" && session.status !== "paused") throw new LogicError("failed-precondition", "Nothing to stop.");
      next = { status: "stopped", resumedAt: null, accumulatedSec };
      writes.push({ path: `buddySessions/${input.historyId}`, data: { id: input.historyId, pairId: pair.id, members: pair.members, status: "stopped", startedAt: session.startedAt, resumedAt: null, accumulatedSec, participants, startedBy: session.startedBy, updatedAt: clock.stamp, finalizedAt: clock.stamp } });
      for (const [uid, entry] of Object.entries(participants)) {
        const minutes = Math.min(60, Math.floor(entry.seconds / 60));
        const ctx = input.contexts.get(uid);
        if (!ctx || minutes < 1) {
          credited[uid] = { minutes: 0, rewards: null };
          continue;
        }
        const eventId = `session_${uid}_buddy-${input.historyId}`;
        if (ctx.eventDone) {
          credited[uid] = { minutes: 0, rewards: null };
          continue;
        }
        writes.push({ path: `learningSessions/${eventId}`, data: { id: eventId, userId: uid, topicId: null, kind: "buddy", minutes, date: clock.today, createdAt: clock.stamp } });
        const outcome = computeOutcome(ctx, { eventId, reason: "buddy_session", refId: input.historyId, xp: minutes * ctx.config.studyMinuteXp, coins: 0, activity: { minutes } }, clock);
        writes.push(...outcome.writes);
        credited[uid] = { minutes, rewards: outcome.result };
      }
      break;
    }
    case "reset":
      if (session.status === "running") throw new LogicError("failed-precondition", "Pause or stop before resetting.");
      next = { status: "idle", startedAt: null, resumedAt: null, accumulatedSec: 0, startedBy: null };
      for (const uid of Object.keys(participants)) participants[uid] = { ...participants[uid], seconds: 0 };
      break;
  }
  writes.unshift({ path, merge: true, data: { ...base, ...next } });
  return { writes, result: { status: (next.status ?? session.status) as SharedSessionState["status"], accumulatedSec: next.accumulatedSec ?? accumulatedSec, credited } };
}

// ---------- challenges ----------

export const CHALLENGE_TARGETS: Record<ChallengeKind, { min: number; max: number; unit: string }> = {
  study_minutes: { min: 30, max: 1200, unit: "minutes" },
  questions: { min: 5, max: 500, unit: "questions" },
  chapter: { min: 1, max: 10, unit: "chapters" },
  assessment: { min: 1, max: 10, unit: "assessments" }
};

export interface CreateChallengeInput {
  uid: string;
  pair: BuddyPairDoc | null;
  kind: ChallengeKind;
  target: number;
  days: number;
  challengeId: string;
  clock: Clock;
}

export function createChallenge(input: CreateChallengeInput): { writes: WriteOp[]; result: { challengeId: string } } {
  const pair = requireMember(input.uid, input.pair);
  const bounds = CHALLENGE_TARGETS[input.kind];
  if (!bounds) throw new LogicError("invalid-argument", "Unknown challenge kind.");
  if (!Number.isInteger(input.target) || input.target < bounds.min || input.target > bounds.max) throw new LogicError("invalid-argument", `Target must be between ${bounds.min} and ${bounds.max} ${bounds.unit}.`);
  const days = Math.max(1, Math.min(30, Math.round(input.days)));
  const titles: Record<ChallengeKind, string> = { study_minutes: `Study ${input.target} minutes each`, questions: `Solve ${input.target} questions each`, chapter: `Complete ${input.target} chapter${input.target > 1 ? "s" : ""} each`, assessment: `Finish ${input.target} assessment${input.target > 1 ? "s" : ""} each` };
  const challenge: BuddyChallengeDoc = {
    id: input.challengeId, pairId: pair.id, members: pair.members, kind: input.kind, target: input.target, title: titles[input.kind],
    progress: Object.fromEntries(pair.members.map((member) => [member, 0])), completed: false, rewardedUids: [],
    startsAt: input.clock.stamp, endsAt: new Date(input.clock.now.getTime() + days * 86_400_000), createdBy: input.uid, createdAt: input.clock.stamp
  };
  return { writes: [{ path: `buddyChallenges/${challenge.id}`, data: challenge as unknown as Record<string, unknown> }], result: { challengeId: challenge.id } };
}

export interface RefreshInput {
  uid: string;
  challenge: BuddyChallengeDoc;
  /** Validated activity per member since startsAt, computed by the caller from server documents. */
  counts: Record<string, number>;
  contexts: Map<string, OutcomeContext>;
  clock: Clock;
}

/** Updates progress from real activity and pays each member once when everyone reaches the target. */
export function refreshChallenge(input: RefreshInput): { writes: WriteOp[]; result: { progress: Record<string, number>; completed: boolean; rewarded: string[] } } {
  const { challenge, clock } = input;
  if (!challenge.members.includes(input.uid)) throw new LogicError("permission-denied", "You are not in this challenge.");
  const progress: Record<string, number> = {};
  for (const member of challenge.members) progress[member] = Math.min(challenge.target, input.counts[member] ?? 0);
  const everyone = challenge.members.every((member) => progress[member] >= challenge.target);
  const expired = toMillis(challenge.endsAt) !== null && clock.now.getTime() > (toMillis(challenge.endsAt) as number);
  const completed = challenge.completed || (everyone && !expired);
  const writes: WriteOp[] = [];
  const rewarded: string[] = [];
  if (completed) {
    for (const member of challenge.members) {
      const ctx = input.contexts.get(member);
      if (challenge.rewardedUids.includes(member) || !ctx || ctx.eventDone) continue;
      const outcome = computeOutcome(ctx, { eventId: `challenge_${challenge.id}_${member}`, reason: "buddy_challenge", refId: challenge.id, xp: ctx.config.challengeXp, coins: ctx.config.challengeCoins }, clock);
      writes.push(...outcome.writes);
      rewarded.push(member);
    }
  }
  writes.unshift({ path: `buddyChallenges/${challenge.id}`, merge: true, data: { progress, completed, rewardedUids: [...challenge.rewardedUids, ...rewarded] } });
  return { writes, result: { progress, completed, rewarded } };
}

/** Counts validated activity for a member since a start time, from documents the caller has read. */
export function countActivity(kind: ChallengeKind, docs: { learningSessions: { minutes: number; createdAt: unknown }[]; questionAttempts: { correct: boolean; createdAt: unknown }[]; chapterProgress: { completed: boolean; completedAt: unknown }[]; assessmentAttempts: { finalized: boolean; finalizedAt: unknown }[] }, sinceMs: number): number {
  const after = (value: unknown) => (toMillis(value) ?? 0) >= sinceMs;
  switch (kind) {
    case "study_minutes":
      return docs.learningSessions.filter((row) => after(row.createdAt)).reduce((sum, row) => sum + row.minutes, 0);
    case "questions":
      return docs.questionAttempts.filter((row) => row.correct && after(row.createdAt)).length;
    case "chapter":
      return docs.chapterProgress.filter((row) => row.completed && after(row.completedAt)).length;
    case "assessment":
      return docs.assessmentAttempts.filter((row) => row.finalized && after(row.finalizedAt)).length;
  }
}

export function sessionDoc(session: BuddySessionDoc | null, pairId: string, members: string[]): SharedSessionState & { id: string } {
  return session ?? { ...emptySession(), id: `${pairId}_live`, participants: Object.fromEntries(members.map((member) => [member, { joinedAt: null, seconds: 0, present: false }])) };
}
