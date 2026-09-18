import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { RewardConfig } from "../types.js";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export const auth = getAuth();

export function requireUid(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return request.auth.uid;
}

export function requireAdmin(request: CallableRequest<unknown>): string {
  const uid = requireUid(request);
  if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin access required.");
  return uid;
}

export function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new HttpsError("invalid-argument", `Invalid ${field}.`);
  }
  return value.trim();
}

export function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpsError("invalid-argument", `Invalid ${field}.`);
  }
  return value;
}

export const DEFAULT_CONFIG: RewardConfig = {
  lessonXp: 50,
  questionXpByDifficulty: { "1": 10, "2": 20, "3": 35 },
  questionCoinsByDifficulty: { "1": 1, "2": 2, "3": 4 },
  assessmentXpPerQuestion: 10,
  assessmentCoinsPerCorrect: 1,
  chapterCompleteXp: 200,
  chapterCompleteCoins: 25,
  challengeXp: 150,
  challengeCoins: 20,
  revisionXp: 25,
  studyMinuteXp: 1,
  streakDayMinutes: 20,
  streakDayQuestions: 10,
  spinCooldownHours: 24,
  spinOutcomes: [
    { label: "+10 Orbit Coins", weight: 30, xp: 0, coins: 10, streakProtection: 0, badgeId: null },
    { label: "+25 Orbit Coins", weight: 20, xp: 0, coins: 25, streakProtection: 0, badgeId: null },
    { label: "+50 Orbit Coins", weight: 8, xp: 0, coins: 50, streakProtection: 0, badgeId: null },
    { label: "+100 XP", weight: 20, xp: 100, coins: 0, streakProtection: 0, badgeId: null },
    { label: "Streak Protection", weight: 7, xp: 0, coins: 0, streakProtection: 1, badgeId: null },
    { label: "Try Again Tomorrow", weight: 15, xp: 0, coins: 0, streakProtection: 0, badgeId: null }
  ],
  aiDailyLimit: 40,
  streakMilestones: [1, 7, 30, 50, 90, 100],
  goodieCriteria: { chapters: 20, questions: 2000, streak: 30 },
  ninetyDayCriteria: { activeDays: 90, streak: 90, studyHours: 100, questions: 1500, chapters: 15 }
};

let cachedConfig: { value: RewardConfig; loadedAt: number } | null = null;
const CONFIG_TTL_MS = 60_000;

/** Reward values live in appConfig/rewards so admins can tune them without a deploy. */
export async function loadConfig(): Promise<RewardConfig> {
  if (cachedConfig && Date.now() - cachedConfig.loadedAt < CONFIG_TTL_MS) return cachedConfig.value;
  const snap = await db.doc("appConfig/rewards").get();
  const value = { ...DEFAULT_CONFIG, ...(snap.exists ? (snap.data() as Partial<RewardConfig>) : {}) };
  cachedConfig = { value, loadedAt: Date.now() };
  return value;
}
