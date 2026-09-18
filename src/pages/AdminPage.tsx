import { useState } from "react";
import { collection, doc, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { timeAgo } from "../lib/format";
import { db } from "../lib/firebase";
import { useAction, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, InlineError, PageHeader, Tabs, Tag } from "../components/ui";
import type { RedemptionDoc, ReportDoc, RewardDoc } from "../lib/types";

type Tab = "reports" | "redemptions" | "store";
const STATUSES: RedemptionDoc["status"][] = ["pending", "approved", "fulfilled", "rejected"];

/** Moderation and fulfilment. Hidden from students; every write here is also gated by Firestore rules on the admin claim. */
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("reports");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Admin" subtitle="Reports, redemptions and store stock. Security is enforced by Firestore rules and custom claims, not by this UI." />
      <Tabs tabs={[{ id: "reports", label: "Reports" }, { id: "redemptions", label: "Redemptions" }, { id: "store", label: "Orbit Store" }]} value={tab} onChange={setTab} />
      {tab === "reports" && <ReportsTab />}
      {tab === "redemptions" && <RedemptionsTab />}
      {tab === "store" && <StoreTab />}
    </div>
  );
}

function ReportsTab() {
  const reports = useQueryOnce<ReportDoc>(() => query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)), []);
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
              <Tag tone="warn">{report.reason.replace(/_/g, " ")}</Tag>
              <span className="font-semibold">{report.targetType.replace(/_/g, " ")}</span>
              <span className="text-ink-500">{report.targetId}</span>
              <span className="text-ink-500">· {timeAgo(report.createdAt)}</span>
            </div>
            {report.details && <p className="mt-2 text-sm text-ink-700">{report.details}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={setStatus.busy} onClick={() => void setStatus.run(report.id, "resolved")}>Resolve</button>
              <button type="button" className="btn-secondary" disabled={setStatus.busy} onClick={() => void setStatus.run(report.id, "dismissed")}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
      <InlineError message={setStatus.error} />
    </AsyncState>
  );
}

function RedemptionsTab() {
  const redemptions = useQueryOnce<RedemptionDoc>(() => query(collection(db, "redemptions"), orderBy("createdAt", "desc"), limit(50)), []);
  const setStatus = useAction(async (id: string, status: RedemptionDoc["status"]) => {
    await updateDoc(doc(db, "redemptions", id), { status });
    redemptions.reload();
  });
  return (
    <AsyncState loading={redemptions.loading} error={redemptions.error} onRetry={redemptions.reload} empty={redemptions.data.length === 0} emptyTitle="No redemptions yet">
      <ul className="space-y-2 text-sm">
        {redemptions.data.map((item) => (
          <li key={item.id} className="card flex flex-wrap items-center justify-between gap-2 py-3">
            <span>{item.rewardName} <span className="text-ink-500">· {item.coinsSpent} coins · {item.userId.slice(0, 8)}… · {timeAgo(item.createdAt)}</span></span>
            <select className="input w-36" aria-label={`Status for ${item.rewardName}`} value={item.status} disabled={setStatus.busy} onChange={(event) => void setStatus.run(item.id, event.target.value as RedemptionDoc["status"])}>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <InlineError message={setStatus.error} />
    </AsyncState>
  );
}

function StoreTab() {
  const rewards = useQueryOnce<RewardDoc>(() => query(collection(db, "rewards"), orderBy("order")), []);
  const update = useAction(async (reward: RewardDoc, patch: Partial<RewardDoc>) => {
    await updateDoc(doc(db, "rewards", reward.id), patch);
    rewards.reload();
  });
  return (
    <AsyncState loading={rewards.loading} error={rewards.error} onRetry={rewards.reload} empty={rewards.data.length === 0} emptyTitle="No rewards">
      <ul className="space-y-2 text-sm">
        {rewards.data.map((reward) => (
          <li key={reward.id} className="card flex flex-wrap items-center justify-between gap-2 py-3">
            <span>{reward.icon} {reward.name} <span className="text-ink-500">· {reward.coinPrice} coins</span> {!reward.available && <Tag tone="warn">Disabled</Tag>}</span>
            <span className="flex items-center gap-2">
              <label className="text-xs text-ink-500">Stock <input className="input w-20" type="number" min={0} defaultValue={reward.stock} onBlur={(event) => { const stock = Math.max(0, Number(event.target.value) || 0); if (stock !== reward.stock) void update.run(reward, { stock }); }} /></label>
              <button type="button" className="btn-secondary" disabled={update.busy} onClick={() => void update.run(reward, { available: !reward.available })}>{reward.available ? "Disable" : "Enable"}</button>
            </span>
          </li>
        ))}
      </ul>
      <InlineError message={update.error} />
    </AsyncState>
  );
}
