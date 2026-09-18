export interface BadgeStats {
  lessonsCompleted: number;
  questionsSolved: number;
  assessmentsCompleted: number;
  streakCurrent: number;
}

interface BadgeRule {
  id: string;
  earned: (stats: BadgeStats) => boolean;
}

/** Mirrors seed/content/badges.json `criteria`. Conditions use server counters only. */
export const BADGE_RULES: BadgeRule[] = [
  { id: "first_step", earned: (stats) => stats.lessonsCompleted >= 1 || stats.questionsSolved >= 1 },
  { id: "week_warrior", earned: (stats) => stats.streakCurrent >= 7 },
  { id: "consistency_champion", earned: (stats) => stats.streakCurrent >= 30 },
  { id: "knowledge_explorer", earned: (stats) => stats.lessonsCompleted >= 10 },
  { id: "problem_solver", earned: (stats) => stats.questionsSolved >= 100 },
  { id: "orbit_explorer", earned: (stats) => stats.lessonsCompleted >= 1 && stats.questionsSolved >= 1 && stats.assessmentsCompleted >= 1 },
  { id: "ninety_day_champion", earned: (stats) => stats.streakCurrent >= 90 }
];

/** Badges newly earned given current stats. Already-awarded ids are skipped so a badge is never granted twice. */
export function badgesToAward(stats: BadgeStats, alreadyAwarded: string[]): string[] {
  return BADGE_RULES.filter((rule) => !alreadyAwarded.includes(rule.id) && rule.earned(stats)).map((rule) => rule.id);
}
