import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { api, type OutcomeResult } from "../lib/callables";
import { formatDuration, istToday, newId, timeAgo, toDate } from "../lib/format";
import { db } from "../lib/firebase";
import { useAction, useDoc, useQueryOnce } from "../hooks/useFirestore";
import { effectiveStreak } from "../../functions/src/lib/streak.js";
import { eligibilityProblem } from "../../functions/src/lib/rewards.js";
import { AsyncState, InlineError, Modal, PageHeader, ProgressBar, RewardToast, StatTile, Tag } from "../components/ui";
import type { BadgeDoc, LedgerTransactionDoc, RedemptionDoc, RewardConfig, RewardDoc, SpinHistoryDoc, SpinStateDoc, UserDoc } from "../lib/types";

export default function RewardsPage() {
  const { user, profile, streak } = useAuth();
  const { rewardId } = useParams();
  const uid = user?.uid ?? "";
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const coinLedger = useQueryOnce<LedgerTransactionDoc>(() => (uid ? query(collection(db, "coinTransactions"), where("userId", "==", uid), orderBy("createdAt", "desc"), limit(10)) : null), [uid]);
  const xpLedger = useQueryOnce<LedgerTransactionDoc>(() => (uid ? query(collection(db, "xpTransactions"), where("userId", "==", uid), orderBy("createdAt", "desc"), limit(10)) : null), [uid]);
  const redemptions = useQueryOnce<RedemptionDoc>(() => (uid ? query(collection(db, "redemptions"), where("userId", "==", uid), orderBy("createdAt", "desc")) : null), [uid]);
  const config = useDoc<RewardConfig>("appConfig/rewards");
  const today = istToday();
  const streakToday = streak ? effectiveStreak(streak, today) : 0;
  const refresh = () => { coinLedger.reload(); xpLedger.reload(); };
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Rewards" subtitle="Orbit Coins are your reward currency, XP tracks learning progress. Both are written only by the server for validated learning." />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Orbit Coins" value={`🪙 ${profile.coins}`} hint="Spend in the Orbit Store" />
        <StatTile label="XP" value={`⚡ ${profile.xp}`} hint="Learning progression" />
        <StatTile label="Streak" value={`🔥 ${streakToday} days`} hint={`Longest ${streak?.longest ?? 0}${streak?.protectionTokens ? ` · ${streak.protectionTokens} protection` : ""}`} />
        <StatTile label="Active days" value={profile.activeDays} hint="days with real learning" to="/calendar" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <OrbitSpin uid={uid} onReward={(result) => { setToast(result); refresh(); }} />
        <Programs profile={profile} streakCurrent={streakToday} config={config.data} />
      </div>

      <OrbitStore profile={profile} streakCurrent={streakToday} redemptions={redemptions.data} focusRewardId={rewardId ?? null} onRedeemed={(coins) => { setToast({ xp: 0, coins, streak: { current: streakToday, longest: streak?.longest ?? 0, incremented: false, protectionUsed: false, milestones: [], qualifiedToday: false }, badges: [] }); refresh(); redemptions.reload(); }} />

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <LedgerList title="Recent Orbit Coins" ledger={coinLedger} unit="coins" />
        <LedgerList title="Recent XP" ledger={xpLedger} unit="XP" />
        <div className="card">
          <h2 className="text-lg font-semibold">Redemptions</h2>
          <AsyncState loading={redemptions.loading} error={redemptions.error} onRetry={redemptions.reload} empty={redemptions.data.length === 0} emptyTitle="No redemptions yet" emptyBody="Redeem an item from the Orbit Store and track it here." skeletonLines={2}>
            <ul className="mt-3 divide-y divide-ink-200 text-sm">
              {redemptions.data.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-2">
                  <span>{item.rewardName} <span className="text-ink-500">· {timeAgo(item.createdAt)}</span></span>
                  <Tag tone={item.status === "fulfilled" ? "success" : item.status === "rejected" ? "danger" : "warn"}>{item.status}</Tag>
                </li>
              ))}
            </ul>
          </AsyncState>
        </div>
      </section>
      <BadgeGrid uid={uid} profile={profile} />
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function LedgerList({ title, ledger, unit }: { title: string; ledger: { data: LedgerTransactionDoc[]; loading: boolean; error: string | null; reload: () => void }; unit: string }) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold">{title}</h2>
      <AsyncState loading={ledger.loading} error={ledger.error} onRetry={ledger.reload} empty={ledger.data.length === 0} emptyTitle={`No ${unit} yet`} emptyBody="Complete a lesson, answer questions or finish a study session to earn some." skeletonLines={2}>
        <ul className="mt-3 divide-y divide-ink-200 text-sm">
          {ledger.data.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between py-2">
              <span>{entry.reason.replace(/_/g, " ")} <span className="text-ink-500">· {timeAgo(entry.createdAt)}</span></span>
              <span className={`font-semibold ${entry.amount < 0 ? "text-danger-500" : "text-success-500"}`}>{entry.amount > 0 ? "+" : ""}{entry.amount} {unit}</span>
            </li>
          ))}
        </ul>
      </AsyncState>
    </div>
  );
}

function OrbitSpin({ uid, onReward }: { uid: string; onReward: (result: OutcomeResult) => void }) {
  const spinState = useDoc<SpinStateDoc>(uid ? `spinState/${uid}` : null);
  const history = useQueryOnce<SpinHistoryDoc>(() => (uid ? query(collection(db, "spinHistory"), where("userId", "==", uid), orderBy("createdAt", "desc"), limit(5)) : null), [uid]);
  const [now, setNow] = useState(Date.now());
  const [lastResult, setLastResult] = useState<string | null>(null);
  const spin = useAction(async () => api.spinWheel({}));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const nextSpinAt = toDate(spinState.data?.nextSpinAt)?.getTime() ?? null;
  const ready = nextSpinAt === null || now >= nextSpinAt;
  async function doSpin() {
    const result = await spin.run();
    if (result) {
      setLastResult(result.result);
      onReward(result.rewards);
      spinState.reload();
      history.reload();
    }
  }
  return (
    <section className="card" aria-labelledby="spin-heading">
      <h2 id="spin-heading" className="text-lg font-semibold">Orbit Spin</h2>
      <p className="text-sm text-ink-500">One spin every 24 hours, decided and timed by the server. Wins: Orbit Coins, XP or a streak protection token.</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className={`flex h-24 w-24 items-center justify-center rounded-full border-4 border-brand-500 text-3xl ${spin.busy ? "animate-spin" : ""}`} aria-hidden="true">🪐</div>
        <div>
          <button type="button" className="btn-primary" disabled={!ready || spin.busy || spinState.loading} onClick={() => void doSpin()}>{spin.busy ? "Spinning..." : ready ? "Spin now" : `Next spin in ${formatDuration(Math.ceil(((nextSpinAt ?? now) - now) / 1000))}`}</button>
          {lastResult && <p className="mt-2 text-sm font-semibold text-brand-700" role="status">Result: {lastResult}</p>}
          <InlineError message={spin.error} />
        </div>
      </div>
      {history.data.length > 0 && <p className="mt-3 text-xs text-ink-500">Recent: {history.data.map((item) => item.result).join(" · ")}</p>}
    </section>
  );
}

function Programs({ profile, streakCurrent, config }: { profile: UserDoc; streakCurrent: number; config: RewardConfig | null }) {
  if (!config) return <div className="card text-sm text-ink-500">Loading reward programs...</div>;
  const goodie = config.goodieCriteria;
  const ninety = config.ninetyDayCriteria;
  const rows = [
    { title: "Free Goodie Program", items: [["Chapters", profile.chaptersCompleted, goodie.chapters], ["Questions", profile.questionsSolved, goodie.questions], ["Streak", streakCurrent, goodie.streak]] as [string, number, number][] },
    { title: "90-Day Champion Reward", items: [["Active days", profile.activeDays, ninety.activeDays], ["Streak", streakCurrent, ninety.streak], ["Study hours", Math.floor(profile.totalStudyMinutes / 60), ninety.studyHours], ["Questions", profile.questionsSolved, ninety.questions], ["Chapters", profile.chaptersCompleted, ninety.chapters]] as [string, number, number][] }
  ];
  return (
    <section className="card" aria-label="Reward programs">
      {rows.map((program) => {
        const complete = program.items.every(([, value, target]) => value >= target);
        return (
          <div key={program.title} className="mb-4 last:mb-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">{program.title} {complete && <Tag tone="success">Criteria met</Tag>}</h2>
            <ul className="mt-2 space-y-2">
              {program.items.map(([label, value, target]) => (
                <li key={label}><ProgressBar value={(value / target) * 100} label={`${label}: ${value} / ${target}`} tone={value >= target ? "success" : "brand"} /></li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="text-xs text-ink-500">Criteria are configurable in appConfig/rewards. Claims open when every bar is full.</p>
    </section>
  );
}

function OrbitStore({ profile, streakCurrent, redemptions, focusRewardId, onRedeemed }: { profile: UserDoc; streakCurrent: number; redemptions: RedemptionDoc[]; focusRewardId: string | null; onRedeemed: (coins: number) => void }) {
  const [version, setVersion] = useState(0);
  const rewards = useContent(() => content.rewardsLive(), [version]);
  const [selected, setSelected] = useState<RewardDoc | null>(null);
  const [redemptionKey, setRedemptionKey] = useState(newId());
  const redeem = useAction(async (reward: RewardDoc) => api.redeemReward({ rewardId: reward.id, redemptionKey }));
  useEffect(() => {
    if (focusRewardId && rewards.data) setSelected(rewards.data.find((reward) => reward.id === focusRewardId) ?? null);
  }, [focusRewardId, rewards.data]);
  const userForEligibility = useMemo(() => ({ ...profile, badgeIds: [] }), [profile]);
  async function confirm() {
    if (!selected) return;
    const result = await redeem.run(selected);
    if (result) {
      if (!result.alreadyRedeemed) onRedeemed(-result.coinsSpent);
      setSelected(null);
      setRedemptionKey(newId());
      setVersion((value) => value + 1);
    }
  }
  return (
    <section className="mt-6" aria-labelledby="store-heading">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="store-heading" className="text-xl font-bold">Orbit Store</h2>
          <p className="text-sm text-ink-500">Coins are deducted only after eligibility, balance and stock pass in one server transaction.</p>
        </div>
        <Link to="/rewards" className="text-sm text-brand-600 hover:underline">Refresh</Link>
      </div>
      <AsyncState loading={rewards.loading} error={rewards.error} empty={(rewards.data ?? []).length === 0} emptyTitle="Store is empty" emptyBody="Rewards are loaded by the seed script.">
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rewards.data ?? []).map((reward) => {
            const problem = eligibilityProblem(reward, userForEligibility, streakCurrent);
            const already = reward.oncePerUser && redemptions.some((item) => item.rewardId === reward.id);
            const affordable = profile.coins >= reward.coinPrice;
            return (
              <li key={reward.id} className="card flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-semibold"><span aria-hidden="true">{reward.icon}</span> {reward.name}</p>
                  <Tag tone={reward.stock > 0 ? "neutral" : "danger"}>{reward.stock > 0 ? `${reward.stock} left` : "Out of stock"}</Tag>
                </div>
                <p className="mt-1 flex-1 text-sm text-ink-700">{reward.description}</p>
                <p className="mt-2 text-sm font-semibold">🪙 {reward.coinPrice}</p>
                {problem && <p className="mt-1 text-xs text-warn-500">{problem}</p>}
                {!problem && !affordable && <p className="mt-1 text-xs text-ink-500">You need {reward.coinPrice - profile.coins} more coins.</p>}
                {already && <p className="mt-1 text-xs text-ink-500">Already redeemed (once per student).</p>}
                <button type="button" className="btn-primary mt-3" disabled={Boolean(problem) || !affordable || already} onClick={() => setSelected(reward)}>Redeem</button>
              </li>
            );
          })}
        </ul>
      </AsyncState>
      <Modal open={Boolean(selected)} title="Confirm redemption" onClose={() => setSelected(null)}>
        {selected && (
          <div className="text-sm">
            <p>Redeem <span className="font-semibold">{selected.name}</span> for <span className="font-semibold">{selected.coinPrice} Orbit Coins</span>? You will have {profile.coins - selected.coinPrice} left.</p>
            <p className="mt-2 text-ink-500">Physical items are shipped by the EduOrbit team after the redemption is approved. If anything fails, no coins are deducted.</p>
            <InlineError message={redeem.error} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={redeem.busy} onClick={() => void confirm()}>{redeem.busy ? "Redeeming..." : "Confirm"}</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function BadgeGrid({ uid, profile }: { uid: string; profile: UserDoc }) {
  const badges = useContent(() => content.badges(), []);
  const earned = useQueryOnce<{ badgeId: string }>(() => (uid ? query(collection(db, `userBadges/${uid}/badges`)) : null), [uid]);
  const owned = new Set([...earned.data.map((item) => item.badgeId), ...(((profile as unknown as { badgeIds?: string[] }).badgeIds) ?? [])]);
  return (
    <section className="card mt-6" aria-labelledby="badges-heading">
      <h2 id="badges-heading" className="text-lg font-semibold">Badges</h2>
      <AsyncState loading={badges.loading || earned.loading} error={badges.error ?? earned.error} skeletonLines={2}>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(badges.data ?? []).map((badge: BadgeDoc) => (
            <li key={badge.id} className={`rounded-xl border p-3 text-sm ${owned.has(badge.id) ? "border-success-500 bg-success-500/10" : "border-ink-200 opacity-70"}`}>
              <p className="font-semibold">{badge.icon} {badge.name}</p>
              <p className="text-xs text-ink-500">{badge.description}</p>
            </li>
          ))}
        </ul>
      </AsyncState>
    </section>
  );
}
