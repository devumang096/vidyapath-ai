import { useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { content, useContent } from "../lib/content";
import { timeAgo } from "../lib/format";
import { db } from "../lib/firebase";
import { useAction, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, InlineError, PageHeader, Tag } from "../components/ui";
import type { DoubtDoc, ReportDoc, RewardClaimDoc, RewardDoc } from "../lib/types";

type Tab = "reports" | "content" | "rewards" | "challenges";
const TABS: { id: Tab; label: string }[] = [
  { id: "reports", label: "Reports" },
  { id: "content", label: "Content" },
  { id: "rewards", label: "Rewards" },
  { id: "challenges", label: "Challenges" }
];
const CLAIM_STATUSES: RewardClaimDoc["status"][] = ["pending", "approved", "fulfilled", "rejected"];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("reports");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Admin" subtitle="Security is enforced by Firestore rules and custom claims, not by this UI." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "btn-primary" : "btn-secondary"} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>
      {tab === "reports" && <ReportsTab />}
      {tab === "content" && <ContentTab />}
      {tab === "rewards" && <RewardsTab />}
      {tab === "challenges" && <ChallengesTab />}
    </div>
  );
}

function targetPath(report: ReportDoc): string | null {
  if (report.targetType === "doubt") return `doubts/${report.targetId}`;
  if (report.targetType === "answer" && report.doubtId) return `doubts/${report.doubtId}/answers/${report.targetId}`;
  return null;
}

function ReportsTab() {
  const reports = useQueryOnce<ReportDoc>(() => query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)), []);
  const setHidden = useAction(async (report: ReportDoc, hidden: boolean) => {
    const path = targetPath(report);
    if (!path) throw new Error("User reports have no content to hide. Resolve or dismiss instead.");
    await updateDoc(doc(db, path), { hidden });
  });
  const setStatus = useAction(async (reportId: string, status: ReportDoc["status"]) => {
    await updateDoc(doc(db, "reports", reportId), { status });
    reports.reload();
  });
  return (
    <AsyncState loading={reports.loading} error={reports.error} onRetry={reports.reload} empty={reports.data.length === 0} emptyTitle="No open reports" emptyBody="Reports from students appear here.">
      <ul className="space-y-3">
        {reports.data.map((report) => (
          <li key={report.id} className="card">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Tag tone="warn">{report.reason}</Tag>
              <span className="font-semibold">{report.targetType}</span>
              <span className="text-ink-500">{report.targetId}</span>
              <span className="text-ink-500">· {timeAgo(report.createdAt)}</span>
              {report.doubtId && <Link className="text-brand-600 hover:underline" to={`/doubts/${report.doubtId}`}>Open doubt</Link>}
            </div>
            {report.details && <p className="mt-2 text-sm text-ink-700">{report.details}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {targetPath(report) && (
                <>
                  <button type="button" className="btn-danger" disabled={setHidden.busy} onClick={() => void setHidden.run(report, true)}>Hide content</button>
                  <button type="button" className="btn-secondary" disabled={setHidden.busy} onClick={() => void setHidden.run(report, false)}>Restore</button>
                </>
              )}
              <button type="button" className="btn-primary" disabled={setStatus.busy} onClick={() => void setStatus.run(report.id, "resolved")}>Resolve</button>
              <button type="button" className="btn-secondary" disabled={setStatus.busy} onClick={() => void setStatus.run(report.id, "dismissed")}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
      <InlineError message={setHidden.error ?? setStatus.error} />
    </AsyncState>
  );
}

function ContentTab() {
  const visible = useQueryOnce<DoubtDoc>(() => query(collection(db, "doubts"), where("hidden", "==", false), orderBy("createdAt", "desc"), limit(20)), []);
  const hidden = useQueryOnce<DoubtDoc>(() => query(collection(db, "doubts"), where("hidden", "==", true), orderBy("createdAt", "desc"), limit(20)), []);
  const toggle = useAction(async (doubtId: string, nextHidden: boolean) => {
    await updateDoc(doc(db, "doubts", doubtId), { hidden: nextHidden });
    visible.reload();
    hidden.reload();
  });
  const renderList = (items: DoubtDoc[], hiddenList: boolean) => (
    <ul className="space-y-2">
      {items.map((doubt) => (
        <li key={doubt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3 text-sm">
          <span><Link className="font-semibold text-brand-700 hover:underline" to={`/doubts/${doubt.id}`}>{doubt.title}</Link> <span className="text-ink-500">· {doubt.authorName} · {timeAgo(doubt.createdAt)}</span></span>
          <button type="button" className={hiddenList ? "btn-secondary" : "btn-danger"} disabled={toggle.busy} onClick={() => void toggle.run(doubt.id, !hiddenList)}>{hiddenList ? "Restore" : "Hide"}</button>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h2 className="font-semibold">Recent visible doubts</h2>
        <AsyncState loading={visible.loading} error={visible.error} onRetry={visible.reload} empty={visible.data.length === 0} emptyTitle="Nothing visible">{renderList(visible.data, false)}</AsyncState>
      </div>
      <div className="card">
        <h2 className="font-semibold">Hidden doubts</h2>
        <AsyncState loading={hidden.loading} error={hidden.error} onRetry={hidden.reload} empty={hidden.data.length === 0} emptyTitle="Nothing hidden">{renderList(hidden.data, true)}</AsyncState>
      </div>
      <InlineError message={toggle.error} />
    </div>
  );
}

function RewardsTab() {
  const rewards = useQueryOnce<RewardDoc>(() => query(collection(db, "rewards"), orderBy("order")), []);
  const claims = useQueryOnce<RewardClaimDoc>(() => query(collection(db, "rewardClaims"), orderBy("createdAt", "desc"), limit(50)), []);
  const toggleAvailable = useAction(async (reward: RewardDoc) => {
    await updateDoc(doc(db, "rewards", reward.id), { available: !reward.available });
    rewards.reload();
  });
  const setClaimStatus = useAction(async (claimId: string, status: RewardClaimDoc["status"]) => {
    await updateDoc(doc(db, "rewardClaims", claimId), { status });
    claims.reload();
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h2 className="font-semibold">Rewards</h2>
        <AsyncState loading={rewards.loading} error={rewards.error} onRetry={rewards.reload} empty={rewards.data.length === 0} emptyTitle="No rewards">
          <ul className="mt-2 space-y-2 text-sm">
            {rewards.data.map((reward) => (
              <li key={reward.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
                <span>{reward.name} <span className="text-ink-500">· {reward.starsRequired} Stars</span> {!reward.available && <Tag tone="warn">Unavailable</Tag>}</span>
                <button type="button" className="btn-secondary" disabled={toggleAvailable.busy} onClick={() => void toggleAvailable.run(reward)}>{reward.available ? "Disable" : "Enable"}</button>
              </li>
            ))}
          </ul>
        </AsyncState>
        <InlineError message={toggleAvailable.error} />
      </div>
      <div className="card">
        <h2 className="font-semibold">Claims</h2>
        <AsyncState loading={claims.loading} error={claims.error} onRetry={claims.reload} empty={claims.data.length === 0} emptyTitle="No claims yet">
          <ul className="mt-2 space-y-2 text-sm">
            {claims.data.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
                <span>{claim.rewardName} <span className="text-ink-500">· {claim.userId.slice(0, 8)}… · {timeAgo(claim.createdAt)}</span></span>
                <select className="input w-36" aria-label={`Status for ${claim.rewardName}`} value={claim.status} disabled={setClaimStatus.busy} onChange={(event) => void setClaimStatus.run(claim.id, event.target.value as RewardClaimDoc["status"])}>
                  {CLAIM_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </AsyncState>
        <InlineError message={setClaimStatus.error} />
      </div>
    </div>
  );
}

function ChallengesTab() {
  const challenges = useContent(() => content.challenges(), []);
  return (
    <div className="card">
      <h2 className="font-semibold">Daily challenge pool</h2>
      <p className="text-sm text-ink-500">Read-only. Edit seed/content/dailyChallenges.json and rerun the seed script to change the pool.</p>
      <AsyncState loading={challenges.loading} error={challenges.error} empty={(challenges.data ?? []).length === 0} emptyTitle="No challenges seeded">
        <ul className="mt-3 space-y-2 text-sm">
          {(challenges.data ?? []).map((challenge) => (
            <li key={challenge.id} className="rounded-lg border border-ink-200 p-3">
              <p className="font-semibold">{challenge.title} <span className="text-ink-500">· order {challenge.order} · {Math.round(challenge.timeLimitSec / 60)} min</span></p>
              <p className="mt-1 text-xs text-ink-500">{challenge.questionIds.join(", ")}</p>
            </li>
          ))}
        </ul>
      </AsyncState>
    </div>
  );
}
