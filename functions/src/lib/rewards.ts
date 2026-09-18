// Pure logic for the Orbit Spin and the Orbit Store.
import { computeOutcome, notificationOp, type OutcomeContext, type OutcomeResult } from "./outcome.js";
import { LogicError } from "./learning.js";
import { canSpin, pickOutcome } from "./spin.js";
import type { Clock, WriteOp } from "./writes.js";
import type { RedemptionDoc, RewardDoc, SpinOutcome, SpinStateDoc } from "../types.js";

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
