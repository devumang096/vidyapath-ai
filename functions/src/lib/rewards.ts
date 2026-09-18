// Pure logic for the Orbit Spin and the Orbit Store.
import { computeOutcome, notificationOp, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { LogicError } from "./learning.js";
import { canSpin, pickOutcome } from "./spin.js";
import type { Clock, WriteOp } from "./writes.js";
import type { GoodieCriteria, NinetyDayCriteria, RedemptionDoc, RewardDoc, SpinOutcome, SpinStateDoc } from "../types.js";

export interface SpinInput {
  ctx: OutcomeContext;
  clock: Clock;
  state: SpinStateDoc | null;
  expectedSpins: number;
  nextSpinAtMs: number | null;
  random: number;
}

export interface SpinResult {
  result: string;
  xp: number;
  coins: number;
  streakProtection: number;
  nextSpinAt: number;
  rewards: OutcomeResult;
}

/**
 * The server decides eligibility, result and reward. The event id is derived from the spin
 * counter, so two overlapping requests collide on the same event and only one pays out.
 */
export function spin(input: SpinInput): { writes: WriteOp[]; result: SpinResult } {
  const { ctx, clock } = input;
  const uid = ctx.uid;
  const currentSpins = input.state?.totalSpins ?? 0;
  if (ctx.eventDone || currentSpins !== input.expectedSpins) throw new LogicError("already-exists", "Spin already in progress. Refresh to see the result.");
  if (!canSpin(input.nextSpinAtMs, clock.now.getTime())) throw new LogicError("failed-precondition", "Spin is on cooldown.");
  const outcome: SpinOutcome = pickOutcome(ctx.config.spinOutcomes, input.random);
  const eventId = `spin_${uid}_${currentSpins + 1}`;
  const nextSpinAt = clock.now.getTime() + ctx.config.spinCooldownHours * 3600_000;
  const writes: WriteOp[] = [
    { path: `spinState/${uid}`, merge: true, data: { uid, nextSpinAt: new Date(nextSpinAt), lastResult: outcome.label, totalSpins: currentSpins + 1 } },
    { path: `spinHistory/${eventId}`, data: { id: eventId, userId: uid, result: outcome.label, xp: outcome.xp, coins: outcome.coins, createdAt: clock.stamp } }
  ];
  const rewards = computeOutcome(ctx, {
    eventId,
    reason: "orbit_spin",
    refId: eventId,
    xp: outcome.xp,
    coins: outcome.coins,
    badgeIds: outcome.badgeId ? [outcome.badgeId] : [],
    streakProtection: outcome.streakProtection
  }, clock);
  writes.push(...rewards.writes);
  return { writes, result: { result: outcome.label, xp: outcome.xp, coins: outcome.coins, streakProtection: outcome.streakProtection, nextSpinAt, rewards: rewards.result } };
}

export interface RedeemInput {
  ctx: OutcomeContext;
  clock: Clock;
  reward: RewardDoc | null;
  redemptionKey: string;
  existing: RedemptionDoc | null;
  redeemedBefore: boolean;
  streakCurrent: number;
}

export interface RedeemResult {
  alreadyRedeemed: boolean;
  redemptionId: string;
  coinsSpent: number;
  remainingCoins: number;
}

export function eligibilityProblem(reward: RewardDoc, user: OutcomeContext["user"], streakCurrent: number): string | null {
  if (!reward.available) return "This reward is not available right now.";
  if (reward.stock <= 0) return "This reward is out of stock.";
  if (streakCurrent < reward.eligibility.minStreak) return `Needs a ${reward.eligibility.minStreak}-day streak.`;
  if (user.chaptersCompleted < reward.eligibility.minChaptersCompleted) return `Complete ${reward.eligibility.minChaptersCompleted} chapters first.`;
  if (user.questionsSolved < reward.eligibility.minQuestionsSolved) return `Solve ${reward.eligibility.minQuestionsSolved} questions first.`;
  return null;
}

/**
 * Atomic redemption: eligibility, balance and stock are checked against the transactional read;
 * coins are deducted, stock reduced and the redemption created in one set of writes. Any failure
 * throws before a single write is produced, so coins are never deducted on error.
 */
export function redeem(input: RedeemInput): { writes: WriteOp[]; result: RedeemResult } {
  const { ctx, clock, reward } = input;
  const uid = ctx.uid;
  const redemptionId = `${uid}_${input.redemptionKey}`;
  if (ctx.eventDone || input.existing) {
    return { writes: [], result: { alreadyRedeemed: true, redemptionId, coinsSpent: input.existing?.coinsSpent ?? 0, remainingCoins: ctx.user.coins } };
  }
  if (!reward) throw new LogicError("not-found", "Reward not found.");
  const problem = eligibilityProblem(reward, ctx.user, input.streakCurrent);
  if (problem) throw new LogicError("failed-precondition", problem);
  if (reward.oncePerUser && input.redeemedBefore) throw new LogicError("already-exists", "You have already redeemed this reward.");
  if (ctx.user.coins < reward.coinPrice) throw new LogicError("failed-precondition", `You need ${reward.coinPrice - ctx.user.coins} more Orbit Coins.`);
  const writes: WriteOp[] = [
    {
      path: `redemptions/${redemptionId}`,
      data: { id: redemptionId, userId: uid, rewardId: reward.id, rewardName: reward.name, coinsSpent: reward.coinPrice, type: "store", status: "pending", createdAt: clock.stamp }
    },
    { path: `rewards/${reward.id}`, merge: true, data: { stock: reward.stock - 1 } }
  ];
  const outcome = computeOutcome(ctx, { eventId: `redeem_${redemptionId}`, reason: "reward_redemption", refId: reward.id, xp: 0, coins: -reward.coinPrice }, clock);
  writes.push(...outcome.writes);
  const notify = notificationOp(uid, ctx.user.notificationPrefs, "reward", "Redemption received", `${reward.name} is pending fulfilment.`, "/rewards", clock);
  if (notify) writes.push(notify);
  return { writes, result: { alreadyRedeemed: false, redemptionId, coinsSpent: reward.coinPrice, remainingCoins: ctx.user.coins - reward.coinPrice } };
}

export type ProgramId = "goodie" | "ninety_day";

export interface ProgramProgress {
  label: string;
  value: number;
  target: number;
}

/** Progress rows for a program from real counters; every bar must be full to claim. */
export function programProgress(program: ProgramId, user: OutcomeContext["user"], streakCurrent: number, criteria: GoodieCriteria | NinetyDayCriteria): ProgramProgress[] {
  if (program === "goodie") {
    const goodie = criteria as GoodieCriteria;
    return [
      { label: "Chapters completed", value: user.chaptersCompleted, target: goodie.chapters },
      { label: "Questions solved", value: user.questionsSolved, target: goodie.questions },
      { label: "Current streak", value: streakCurrent, target: goodie.streak }
    ];
  }
  const ninety = criteria as NinetyDayCriteria;
  return [
    { label: "Active days", value: user.activeDays, target: ninety.activeDays },
    { label: "Current streak", value: streakCurrent, target: ninety.streak },
    { label: "Study hours", value: Math.floor(user.totalStudyMinutes / 60), target: ninety.studyHours },
    { label: "Questions solved", value: user.questionsSolved, target: ninety.questions },
    { label: "Chapters completed", value: user.chaptersCompleted, target: ninety.chapters }
  ];
}

export interface ClaimProgramInput {
  ctx: OutcomeContext;
  clock: Clock;
  program: ProgramId;
  existing: RedemptionDoc | null;
  streakCurrent: number;
}

/** One claim per program per student, only when every configured criterion is met. Coins are not involved. */
export function claimProgram(input: ClaimProgramInput): { writes: WriteOp[]; result: { alreadyClaimed: boolean; redemptionId: string } } {
  const { ctx, clock, program } = input;
  const redemptionId = `${ctx.uid}_program_${program}`;
  if (input.existing || ctx.eventDone) return { writes: [], result: { alreadyClaimed: true, redemptionId } };
  const criteria = program === "goodie" ? ctx.config.goodieCriteria : ctx.config.ninetyDayCriteria;
  const rows = programProgress(program, ctx.user, input.streakCurrent, criteria);
  const short = rows.filter((row) => row.value < row.target);
  if (short.length) throw new LogicError("failed-precondition", `Not there yet: ${short.map((row) => `${row.label} ${row.value}/${row.target}`).join(", ")}.`);
  const name = program === "goodie" ? "Free Goodie Program reward" : "90-Day Champion reward";
  const writes: WriteOp[] = [
    { path: `redemptions/${redemptionId}`, data: { id: redemptionId, userId: ctx.uid, rewardId: `program_${program}`, rewardName: name, coinsSpent: 0, type: program, status: "pending", createdAt: clock.stamp } },
    { path: `processedEvents/claim_${redemptionId}`, data: { userId: ctx.uid, reason: "program_claim", refId: program, createdAt: clock.stamp } }
  ];
  const notify = notificationOp(ctx.uid, ctx.user.notificationPrefs, "reward", "Reward claimed", `${name} is pending fulfilment.`, "/rewards", clock);
  if (notify) writes.push(notify);
  return { writes, result: { alreadyClaimed: false, redemptionId } };
}
