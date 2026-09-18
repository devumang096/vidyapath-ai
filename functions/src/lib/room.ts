// Shared study room state machine used by Buddy pairs and Groups. Every transition credits the
// elapsed running time to the participants who were present, so per-student time stays accurate
// even when people join and leave mid-session. Stop writes a history document and records a capped
// study session for each participant through the same reward engine as solo sessions.
import { computeOutcome, toMillis, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { LogicError } from "./learning.js";
import type { Clock, WriteOp } from "./writes.js";
import type { SessionKind, SharedSessionState } from "../types.js";

export type RoomAction = "join" | "leave" | "start" | "pause" | "resume" | "stop" | "reset";
export const ROOM_ACTIONS: readonly RoomAction[] = ["join", "leave", "start", "pause", "resume", "stop", "reset"];

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
  session: SharedSessionState;
  action: RoomAction;
  /** Path of the live session document. */
  livePath: string;
  /** Path of the history document written on stop, plus extra fields (pairId, groupId, members). */
  historyPath: string;
  historyExtra: Record<string, unknown>;
  /** Learning session kind recorded for each participant on stop. */
  kind: Extract<SessionKind, "buddy" | "group">;
  /** Outcome contexts for participants, needed only on stop. */
  contexts: Map<string, OutcomeContext>;
  clock: Clock;
}

export interface RoomResult {
  status: SharedSessionState["status"];
  accumulatedSec: number;
  credited: Record<string, { minutes: number; rewards: OutcomeResult | null }>;
}

export function applyRoomAction(input: RoomInput): { writes: WriteOp[]; result: RoomResult } {
  const { clock, action, session } = input;
  const nowMs = clock.now.getTime();
  const participants = creditPresent(session, nowMs);
  const accumulatedSec = runningSeconds(session, nowMs);
  const writes: WriteOp[] = [];
  const credited: RoomResult["credited"] = {};
  const present = () => { participants[input.uid] = participants[input.uid] ? { ...participants[input.uid], present: true } : { joinedAt: clock.stamp, seconds: 0, present: true }; };
  let next: Partial<SharedSessionState> = {};
  switch (action) {
    case "join":
      present();
      next = { resumedAt: session.status === "running" ? clock.stamp : session.resumedAt, accumulatedSec: session.status === "running" ? accumulatedSec : session.accumulatedSec };
      break;
    case "leave":
      if (participants[input.uid]) participants[input.uid] = { ...participants[input.uid], present: false };
      next = { resumedAt: session.status === "running" ? clock.stamp : session.resumedAt, accumulatedSec: session.status === "running" ? accumulatedSec : session.accumulatedSec };
      break;
    case "start": {
      if (session.status === "running") throw new LogicError("failed-precondition", "The room is already running.");
      const fresh = session.status === "idle" || session.status === "stopped";
      present();
      if (fresh) for (const uid of Object.keys(participants)) participants[uid] = { ...participants[uid], seconds: 0 };
      next = { status: "running", startedAt: fresh ? clock.stamp : session.startedAt, resumedAt: clock.stamp, accumulatedSec: session.status === "paused" ? session.accumulatedSec : 0, startedBy: fresh ? input.uid : session.startedBy ?? input.uid };
      break;
    }
    case "pause":
      if (session.status !== "running") throw new LogicError("failed-precondition", "The room is not running.");
      next = { status: "paused", resumedAt: null, accumulatedSec };
      break;
    case "resume":
      if (session.status !== "paused") throw new LogicError("failed-precondition", "The room is not paused.");
      present();
      next = { status: "running", resumedAt: clock.stamp };
      break;
    case "stop": {
      if (session.status !== "running" && session.status !== "paused") throw new LogicError("failed-precondition", "Nothing to stop.");
      next = { status: "stopped", resumedAt: null, accumulatedSec };
      const historyId = input.historyPath.slice(input.historyPath.lastIndexOf("/") + 1);
      writes.push({ path: input.historyPath, data: { id: historyId, ...input.historyExtra, status: "stopped", startedAt: session.startedAt, resumedAt: null, accumulatedSec, participants, startedBy: session.startedBy, updatedAt: clock.stamp, finalizedAt: clock.stamp } });
      for (const [uid, entry] of Object.entries(participants)) {
        const minutes = Math.min(60, Math.floor(entry.seconds / 60));
        const ctx = input.contexts.get(uid);
        if (!ctx || minutes < 1 || ctx.eventDone) {
          credited[uid] = { minutes: 0, rewards: null };
          continue;
        }
        const eventId = `session_${uid}_${input.kind}-${historyId}`;
        writes.push({ path: `learningSessions/${eventId}`, data: { id: eventId, userId: uid, topicId: null, kind: input.kind, minutes, date: clock.today, createdAt: clock.stamp } });
        const outcome = computeOutcome(ctx, { eventId, reason: `${input.kind}_session`, refId: historyId, xp: minutes * ctx.config.studyMinuteXp, coins: 0, activity: { minutes } }, clock);
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
  writes.unshift({ path: input.livePath, merge: true, data: { participants, updatedAt: clock.stamp, ...next } });
  return { writes, result: { status: (next.status ?? session.status) as SharedSessionState["status"], accumulatedSec: next.accumulatedSec ?? accumulatedSec, credited } };
}

/** Event id a stop will use for a participant, so callers can read the matching processedEvents doc up front. */
export function stopEventId(uid: string, kind: RoomInput["kind"], historyId: string): string {
  return `session_${uid}_${kind}-${historyId}`;
}
