// Bridges the pure feature logic in functions/src/lib to any key-value document source: the live
// demo store at runtime, or a plain Map while generating seed history.
import { normalizeActivity, normalizeStreak, normalizeUser, type OutcomeContext } from "../../functions/src/lib/outcome.js";
import { istDate } from "../../functions/src/lib/time.js";
import type { Clock, WriteOp } from "../../functions/src/lib/writes.js";
import type { DailyActivityDoc, RewardConfig, StreakDoc, UserDoc } from "../lib/types";
import { DemoError, newDocId, Timestamp, type DocData } from "./store";

export type Reader = (path: string) => DocData | null;

export function demoClock(now = new Date()): Clock {
  return { now, today: istDate(now), stamp: Timestamp.fromDate(now), newId: newDocId };
}

export function contextFrom(read: Reader, uid: string, eventId: string, clock: Clock): OutcomeContext {
  const config = read("appConfig/rewards") as RewardConfig | null;
  if (!config) throw new DemoError("failed-precondition", "Reward config missing.");
  const user = read(`users/${uid}`) as Partial<UserDoc> | null;
  if (!user) throw new DemoError("failed-precondition", "Profile not found. Complete registration first.");
  return {
    uid,
    config,
    user: normalizeUser(uid, user),
    streak: normalizeStreak((read(`streaks/${uid}`) ?? {}) as Partial<StreakDoc>),
    activity: normalizeActivity((read(`dailyActivity/${uid}_${clock.today}`) ?? {}) as Partial<DailyActivityDoc>),
    eventDone: read(`processedEvents/${eventId}`) !== null
  };
}

/** Applies write ops to a Map, resolving Date values the way the store does. */
export function applyToMap(target: Map<string, DocData>, ops: WriteOp[]): void {
  for (const op of ops) {
    if ("delete" in op) {
      target.delete(op.path);
      continue;
    }
    const data: DocData = {};
    for (const [key, value] of Object.entries(op.data)) data[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
    target.set(op.path, op.merge ? { ...(target.get(op.path) ?? {}), ...data } : data);
  }
}
