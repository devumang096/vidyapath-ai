import { daysBetween } from "./time.js";

export interface StreakState {
  current: number;
  longest: number;
  lastQualifiedDate: string | null;
  protectionTokens: number;
}

export interface ActivityCounts {
  minutes: number;
  questions: number;
  lessons: number;
  assessments: number;
  revisions: number;
}

export interface StreakThresholds {
  streakDayMinutes: number;
  streakDayQuestions: number;
}

/** A day counts only for meaningful learning, never for logging in. */
export function activityQualifies(activity: ActivityCounts, thresholds: StreakThresholds): boolean {
  return (
    activity.minutes >= thresholds.streakDayMinutes ||
    activity.questions >= thresholds.streakDayQuestions ||
    activity.lessons >= 1 ||
    activity.assessments >= 1 ||
    activity.revisions >= 1
  );
}

/**
 * Advance the streak for a day that has just qualified.
 * Same day: unchanged. Next day: +1. One missed day with a protection token: +1 and the
 * token is spent. Otherwise, or on the first ever day: reset to 1.
 */
export function advanceStreak(prev: StreakState, today: string): StreakState & { incremented: boolean; protectionUsed: boolean } {
  if (prev.lastQualifiedDate === today) {
    return { ...prev, incremented: false, protectionUsed: false };
  }
  const gap = prev.lastQualifiedDate ? daysBetween(prev.lastQualifiedDate, today) : Infinity;
  const protectionUsed = gap === 2 && prev.protectionTokens > 0;
  const current = gap === 1 || protectionUsed ? prev.current + 1 : 1;
  return {
    current,
    longest: Math.max(prev.longest, current),
    lastQualifiedDate: today,
    protectionTokens: protectionUsed ? prev.protectionTokens - 1 : prev.protectionTokens,
    incremented: true,
    protectionUsed
  };
}

/** Streak as it should be displayed today: a missed day shows 0 even before any new activity. */
export function effectiveStreak(prev: Pick<StreakState, "current" | "lastQualifiedDate" | "protectionTokens">, today: string): number {
  if (!prev.lastQualifiedDate) return 0;
  const gap = daysBetween(prev.lastQualifiedDate, today);
  if (gap <= 1) return prev.current;
  return gap === 2 && prev.protectionTokens > 0 ? prev.current : 0;
}

export function newMilestones(current: number, milestones: number[], awarded: number[]): number[] {
  return milestones.filter((milestone) => current >= milestone && !awarded.includes(milestone));
}
