// Pure reward engine. No Firebase imports: the Cloud Functions wrap this in a transaction and the
// browser demo applies the same write ops to its in-memory store.
import { activityQualifies, advanceStreak, newMilestones, type ActivityCounts, type StreakState } from "./streak.js";
import { badgesToAward } from "./badges.js";
import type { Clock, WriteOp } from "./writes.js";
import { DEFAULT_NOTIFICATION_PREFS, type DailyActivityDoc, type NotificationPrefs, type RewardConfig, type StreakDoc, type UserDoc } from "../types.js";

/** Server-only counters kept on the user doc so awarding needs no extra reads. */
export interface UserServerFields extends UserDoc {
  badgeIds: string[];
}

export interface ActivitySnapshot extends ActivityCounts {
  correct: number;
  xp: number;
  coins: number;
  topicIds: string[];
  qualified: boolean;
}

/** Everything computeOutcome needs, read inside the same transaction that will write. */
export interface OutcomeContext {
  uid: string;
  config: RewardConfig;
  user: UserServerFields;
  streak: StreakState & { milestonesAwarded: number[] };
  activity: ActivitySnapshot;
  eventDone: boolean;
}

export interface Outcome {
  eventId: string;
  reason: string;
  refId: string;
  xp: number;
  coins: number;
  activity?: Partial<ActivityCounts & { correct: number; topicIds: string[] }>;
  stats?: Partial<Pick<UserServerFields, "questionsSolved" | "lessonsCompleted" | "chaptersCompleted" | "assessmentsCompleted">>;
  badgeIds?: string[];
  streakProtection?: number;
}

export interface OutcomeResult {
  xp: number;
  coins: number;
  streak: { current: number; longest: number; incremented: boolean; protectionUsed: boolean; milestones: number[]; qualifiedToday: boolean };
  badges: string[];
}

export const EMPTY_ACTIVITY: ActivitySnapshot = { minutes: 0, questions: 0, correct: 0, lessons: 0, assessments: 0, revisions: 0, xp: 0, coins: 0, topicIds: [], qualified: false };

export function normalizeUser(uid: string, raw: Partial<UserServerFields>): UserServerFields {
  return {
    ...(raw as UserServerFields),
    uid,
    xp: raw.xp ?? 0,
    coins: raw.coins ?? 0,
    badgeIds: raw.badgeIds ?? [],
    questionsSolved: raw.questionsSolved ?? 0,
    lessonsCompleted: raw.lessonsCompleted ?? 0,
    chaptersCompleted: raw.chaptersCompleted ?? 0,
    assessmentsCompleted: raw.assessmentsCompleted ?? 0,
    totalStudyMinutes: raw.totalStudyMinutes ?? 0,
    activeDays: raw.activeDays ?? 0,
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...(raw.notificationPrefs ?? {}) }
  };
}

export function normalizeStreak(raw: Partial<StreakDoc>): StreakState & { milestonesAwarded: number[] } {
  return {
    current: raw.current ?? 0,
    longest: raw.longest ?? 0,
    lastQualifiedDate: raw.lastQualifiedDate ?? null,
    protectionTokens: raw.protectionTokens ?? 0,
    milestonesAwarded: raw.milestonesAwarded ?? []
  };
}

export function normalizeActivity(raw: Partial<DailyActivityDoc>): ActivitySnapshot {
  return { ...EMPTY_ACTIVITY, ...raw, topicIds: raw.topicIds ?? [] };
}

export function notificationOp(uid: string, prefs: NotificationPrefs, type: keyof NotificationPrefs | "system", title: string, body: string, link: string | null, clock: Clock): WriteOp | null {
  if (type !== "system" && !prefs[type]) return null;
  const id = clock.newId();
  return { path: `notifications/${uid}/items/${id}`, data: { id, type, title, body, link, read: false, createdAt: clock.stamp } };
}

/**
 * Ledger, balances, daily activity, streak, badges and public summary for one event, as write ops.
 * Idempotent: the caller must have checked ctx.eventDone before computing rewards.
 * Balances are written as absolute values computed from the transactional read, never as client input.
 */
export function computeOutcome(ctx: OutcomeContext, outcome: Outcome, clock: Clock): { writes: WriteOp[]; result: OutcomeResult } {
  const { uid, config } = ctx;
  const writes: WriteOp[] = [];
  const activity: ActivitySnapshot = {
    minutes: ctx.activity.minutes + (outcome.activity?.minutes ?? 0),
    questions: ctx.activity.questions + (outcome.activity?.questions ?? 0),
    correct: ctx.activity.correct + (outcome.activity?.correct ?? 0),
    lessons: ctx.activity.lessons + (outcome.activity?.lessons ?? 0),
    assessments: ctx.activity.assessments + (outcome.activity?.assessments ?? 0),
    revisions: ctx.activity.revisions + (outcome.activity?.revisions ?? 0),
    xp: ctx.activity.xp + Math.max(0, outcome.xp),
    coins: ctx.activity.coins + Math.max(0, outcome.coins),
    topicIds: [...new Set([...ctx.activity.topicIds, ...(outcome.activity?.topicIds ?? [])])].slice(0, 50),
    qualified: false
  };
  activity.qualified = activityQualifies(activity, config);
  let streakResult = { ...ctx.streak, incremented: false, protectionUsed: false };
  let milestones: number[] = [];
  const newlyQualified = activity.qualified && !ctx.activity.qualified;
  if (newlyQualified) {
    streakResult = { ...streakResult, ...advanceStreak(ctx.streak, clock.today) };
    milestones = newMilestones(streakResult.current, config.streakMilestones, ctx.streak.milestonesAwarded);
  }
  const protectionTokens = streakResult.protectionTokens + (outcome.streakProtection ?? 0);

  const stats = {
    questionsSolved: ctx.user.questionsSolved + (outcome.stats?.questionsSolved ?? 0),
    lessonsCompleted: ctx.user.lessonsCompleted + (outcome.stats?.lessonsCompleted ?? 0),
    chaptersCompleted: ctx.user.chaptersCompleted + (outcome.stats?.chaptersCompleted ?? 0),
    assessmentsCompleted: ctx.user.assessmentsCompleted + (outcome.stats?.assessmentsCompleted ?? 0),
    totalStudyMinutes: ctx.user.totalStudyMinutes + (outcome.activity?.minutes ?? 0),
    activeDays: ctx.user.activeDays + (newlyQualified ? 1 : 0)
  };
  const badges = [...badgesToAward({ ...stats, streakCurrent: streakResult.current }, ctx.user.badgeIds), ...(outcome.badgeIds ?? [])].filter(
    (badgeId, index, all) => !ctx.user.badgeIds.includes(badgeId) && all.indexOf(badgeId) === index
  );

  writes.push({ path: `processedEvents/${outcome.eventId}`, data: { userId: uid, reason: outcome.reason, refId: outcome.refId, createdAt: clock.stamp } });
  if (outcome.xp > 0) {
    writes.push({ path: `xpTransactions/${outcome.eventId}`, data: { id: outcome.eventId, userId: uid, amount: outcome.xp, reason: outcome.reason, refId: outcome.refId, createdAt: clock.stamp } });
  }
  if (outcome.coins !== 0) {
    writes.push({ path: `coinTransactions/${outcome.eventId}`, data: { id: outcome.eventId, userId: uid, amount: outcome.coins, reason: outcome.reason, refId: outcome.refId, createdAt: clock.stamp } });
  }
  writes.push({
    path: `users/${uid}`,
    merge: true,
    data: { xp: ctx.user.xp + outcome.xp, coins: ctx.user.coins + outcome.coins, ...stats, badgeIds: [...ctx.user.badgeIds, ...badges], updatedAt: clock.stamp }
  });
  writes.push({ path: `dailyActivity/${uid}_${clock.today}`, merge: true, data: { uid, date: clock.today, ...activity, updatedAt: clock.stamp } });
  writes.push({
    path: `streaks/${uid}`,
    merge: true,
    data: {
      uid,
      current: streakResult.current,
      longest: streakResult.longest,
      lastQualifiedDate: streakResult.lastQualifiedDate,
      protectionTokens,
      milestonesAwarded: [...ctx.streak.milestonesAwarded, ...milestones],
      updatedAt: clock.stamp
    }
  });
  for (const badgeId of badges) writes.push({ path: `userBadges/${uid}/badges/${badgeId}`, data: { badgeId, awardedAt: clock.stamp } });
  for (const badgeId of badges) {
    const op = notificationOp(uid, ctx.user.notificationPrefs, "reward", "Badge unlocked", `You earned the ${badgeId.replace(/_/g, " ")} badge.`, "/rewards", clock);
    if (op) writes.push(op);
  }
  for (const milestone of milestones) {
    const op = notificationOp(uid, ctx.user.notificationPrefs, "streak", `${milestone}-day streak!`, `You kept a ${milestone}-day learning streak. Keep going.`, "/rewards", clock);
    if (op) writes.push(op);
  }
  writes.push({
    path: `publicProfiles/${uid}`,
    merge: true,
    data: { progressSummary: { questionsSolved: stats.questionsSolved, lessonsCompleted: stats.lessonsCompleted, accuracy: activity.questions ? Math.round((activity.correct / activity.questions) * 100) : 0 }, updatedAt: clock.stamp }
  });

  return {
    writes,
    result: {
      xp: outcome.xp,
      coins: outcome.coins,
      streak: { current: streakResult.current, longest: streakResult.longest, incremented: streakResult.incremented, protectionUsed: streakResult.protectionUsed, milestones, qualifiedToday: activity.qualified },
      badges
    }
  };
}

export function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return null;
}
