import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, orderBy, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { api, type RankedCandidate, type RoomAction } from "../lib/callables";
import { db } from "../lib/firebase";
import { formatDuration, newId, timeAgo, toDate } from "../lib/format";
import { SUBJECT_NAMES } from "../lib/subjects";
import { useAction, useDoc, useLiveQuery, useQueryOnce } from "../hooks/useFirestore";
import { CHALLENGE_TARGETS, runningSeconds } from "../../functions/src/lib/buddy.js";
import { AsyncState, InlineError, Modal, PageHeader, ProgressBar, RewardToast, Tag } from "../components/ui";
import type { OutcomeResult } from "../lib/callables";
import { CHALLENGE_KIND_LABELS, GOAL_LABELS, LEARNING_LEVEL_LABELS, type BuddyChallengeDoc, type BuddyPairDoc, type BuddyPreferencesDoc, type BuddyRequestDoc, type BuddySessionDoc, type ChallengeKind, type PublicProfile, type ReportReason, type SubjectId } from "../lib/types";

const SCHEDULES: BuddyPreferencesDoc["schedule"][] = ["morning", "afternoon", "evening", "night", "flexible"];
const REPORT_REASONS: ReportReason[] = ["harassment", "inappropriate", "contact_sharing", "spam", "abuse", "other"];

/** Buddy hub: preferences, candidates, requests, the current pair with room and challenges, and block or report. */
export default function BuddyPage({ room = false }: { room?: boolean }) {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const mine = useDoc<PublicProfile>(uid ? `publicProfiles/${uid}` : null);
  const pairs = useLiveQuery<BuddyPairDoc>(() => (uid ? query(collection(db, "buddies"), where("members", "array-contains", uid), where("status", "==", "active")) : null), [uid]);
  const pair = pairs.data[0] ?? null;
  const partnerUid = pair?.members.find((member) => member !== uid) ?? null;
  const partner = useDoc<PublicProfile>(partnerUid ? `publicProfiles/${partnerUid}` : null, [partnerUid]);
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={room ? "Buddy Study Room" : "Buddy"} subtitle="One-to-one peer learning. Other students only ever see your anonymous name, class, goal, subjects and level." crumbs={room ? [{ label: "Buddy", to: "/buddy" }] : undefined} />
      <AsyncState loading={pairs.loading || mine.loading} error={pairs.error ?? mine.error} skeletonLines={4}>
        {pair && partner.data ? (
          room ? (
            <StudyRoom uid={uid} pair={pair} partner={partner.data} onRewards={setToast} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <PairCard uid={uid} pair={pair} partner={partner.data} />
                <Challenges uid={uid} pair={pair} partner={partner.data} onRewards={setToast} />
              </div>
              <aside className="space-y-4">
                <section className="card">
                  <h2 className="text-lg font-semibold">Study room</h2>
                  <p className="mt-1 text-sm text-ink-700">A shared timer for both of you. Start, pause, resume, stop and reset; each student's minutes are credited when you stop.</p>
                  <Link to="/buddy/room" className="btn-primary mt-3">Open the room</Link>
                </section>
                <SessionHistory pair={pair} uid={uid} partnerName={partner.data.anonUsername} />
              </aside>
            </div>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Requests uid={uid} />
              <Candidates uid={uid} />
            </div>
            <aside className="space-y-4">
              <Preferences uid={uid} subjects={profile.subjects} />
              <section className="card text-sm text-ink-700">
                <h2 className="text-lg font-semibold">How Buddy works</h2>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Set your preferences and turn matching on.</li>
                  <li>Send a request to a candidate in your class.</li>
                  <li>When they accept, you get a shared study room and challenges.</li>
                  <li>Unmatch, block or report at any time from your Buddy's card.</li>
                </ol>
                <Link to="/safety" className="mt-2 inline-block text-brand-600 hover:underline">Safety guidelines</Link>
              </section>
            </aside>
          </div>
        )}
      </AsyncState>
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Preferences({ uid, subjects }: { uid: string; subjects: SubjectId[] }) {
  const prefs = useDoc<BuddyPreferencesDoc>(uid ? `buddyPreferences/${uid}` : null);
  const [form, setForm] = useState<Omit<BuddyPreferencesDoc, "uid" | "updatedAt">>({ open: false, subjects, schedule: "evening", genderPreference: "any", gender: "unspecified" });
  useEffect(() => {
    if (prefs.data) setForm({ open: prefs.data.open, subjects: prefs.data.subjects, schedule: prefs.data.schedule, genderPreference: prefs.data.genderPreference, gender: prefs.data.gender });
  }, [prefs.data]);
  const save = useAction(async () => {
    if (form.subjects.length === 0) throw new Error("Pick at least one subject.");
    await setDoc(doc(db, "buddyPreferences", uid), { uid, ...form, updatedAt: serverTimestamp() });
    prefs.reload();
  });
  return (
    <form className="card space-y-3" onSubmit={(event) => { event.preventDefault(); void save.run(); }}>
      <h2 className="text-lg font-semibold">My preferences</h2>
      <label className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"><span>Open to Buddy requests</span><input type="checkbox" checked={form.open} onChange={(event) => setForm({ ...form, open: event.target.checked })} /></label>
      <fieldset>
        <legend className="label">Subjects to study together</legend>
        <div className="flex flex-wrap gap-2">
          {subjects.map((subject) => (
            <label key={subject} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${form.subjects.includes(subject) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
              <input type="checkbox" className="sr-only" checked={form.subjects.includes(subject)} onChange={() => setForm({ ...form, subjects: form.subjects.includes(subject) ? form.subjects.filter((item) => item !== subject) : [...form.subjects, subject] })} />
              {SUBJECT_NAMES[subject]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm"><span className="label">Usual study time</span><select className="input" value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value as BuddyPreferencesDoc["schedule"] })}>{SCHEDULES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm"><span className="label">I am</span><select className="input" value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as BuddyPreferencesDoc["gender"] })}><option value="unspecified">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
        <label className="block text-sm"><span className="label">Match with</span><select className="input" value={form.genderPreference} onChange={(event) => setForm({ ...form, genderPreference: event.target.value as BuddyPreferencesDoc["genderPreference"] })}><option value="any">Anyone</option><option value="same">Same gender only</option></select></label>
      </div>
      <InlineError message={save.error} />
      <button type="submit" className="btn-primary" disabled={save.busy}>{save.busy ? "Saving..." : "Save preferences"}</button>
    </form>
  );
}

function Candidates({ uid }: { uid: string }) {
  const [version, setVersion] = useState(0);
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<RankedCandidate | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    api.findBuddyCandidates({})
      .then((result) => { if (!cancelled) setCandidates(result.candidates); })
      .catch((caught) => { console.error("Candidate search failed", caught); if (!cancelled) setError("Could not load candidates. Try again."); });
    return () => { cancelled = true; };
  }, [uid, version]);
  const send = useAction(async () => {
    if (!target) return null;
    const result = await api.sendBuddyRequest({ toUid: target.uid, message });
    setTarget(null);
    setMessage("");
    setVersion((value) => value + 1);
    return result;
  });
  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Find a Buddy</h2>
        <button type="button" className="btn-ghost py-1" onClick={() => setVersion((value) => value + 1)}>Refresh</button>
      </div>
      <p className="text-sm text-ink-500">Students in your class who are open to requests, ranked by goal, shared subjects, level, language and schedule.</p>
      <AsyncState loading={candidates === null && !error} error={error} empty={(candidates ?? []).length === 0} emptyTitle="No candidates right now" emptyBody="Tell us your learning preferences and find a study partner when more students in your class open up to matching.">
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {(candidates ?? []).map((candidate) => (
            <li key={candidate.uid} className="rounded-xl border border-ink-200 p-4 text-sm">
              <p className="font-semibold">{candidate.anonUsername}</p>
              <p className="text-xs text-ink-500">Class {candidate.classLevel} · {GOAL_LABELS[candidate.goal as keyof typeof GOAL_LABELS] ?? candidate.goal} · {LEARNING_LEVEL_LABELS[candidate.learningLevel as keyof typeof LEARNING_LEVEL_LABELS] ?? candidate.learningLevel}</p>
              <p className="mt-1 text-xs text-ink-700">{candidate.subjects.map((subject) => SUBJECT_NAMES[subject as SubjectId] ?? subject).join(", ")}{candidate.schedule ? ` · ${candidate.schedule}` : ""}</p>
              <p className="mt-1 text-xs text-ink-500">{candidate.reasons.join(" · ")}</p>
              <button type="button" className="btn-primary mt-3" onClick={() => setTarget(candidate)}>Send request</button>
            </li>
          ))}
        </ul>
      </AsyncState>
      <Modal open={Boolean(target)} title={`Request ${target?.anonUsername ?? ""}`} onClose={() => setTarget(null)}>
        <label className="block text-sm"><span className="label">Message (optional, no contact details)</span><textarea className="input" rows={3} maxLength={200} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        <InlineError message={send.error} />
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button type="button" className="btn-primary" disabled={send.busy} onClick={() => void send.run()}>{send.busy ? "Sending..." : "Send"}</button></div>
      </Modal>
    </section>
  );
}

function Requests({ uid }: { uid: string }) {
  const incoming = useLiveQuery<BuddyRequestDoc>(() => (uid ? query(collection(db, "buddyRequests"), where("toUid", "==", uid), where("status", "==", "pending")) : null), [uid]);
  const outgoing = useLiveQuery<BuddyRequestDoc>(() => (uid ? query(collection(db, "buddyRequests"), where("fromUid", "==", uid), where("status", "==", "pending")) : null), [uid]);
  const respond = useAction(async (requestId: string, accept: boolean) => api.respondBuddyRequest({ requestId, accept }));
  const cancel = useAction(async (requestId: string) => api.cancelBuddyRequest({ requestId }));
  if (incoming.data.length === 0 && outgoing.data.length === 0) return null;
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Requests</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {incoming.data.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
            <span><ProfileName uid={request.fromUid} /> wants to be your Buddy{request.message ? `: "${request.message}"` : ""} <span className="text-ink-500">· {timeAgo(request.createdAt)}</span></span>
            <span className="flex gap-2"><button type="button" className="btn-primary py-1" disabled={respond.busy} onClick={() => void respond.run(request.id, true)}>Accept</button><button type="button" className="btn-secondary py-1" disabled={respond.busy} onClick={() => void respond.run(request.id, false)}>Decline</button></span>
          </li>
        ))}
        {outgoing.data.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
            <span>Waiting for <ProfileName uid={request.toUid} /> <span className="text-ink-500">· sent {timeAgo(request.createdAt)}</span></span>
            <button type="button" className="btn-ghost py-1" disabled={cancel.busy} onClick={() => void cancel.run(request.id)}>Cancel</button>
          </li>
        ))}
      </ul>
      <InlineError message={respond.error ?? cancel.error} />
    </section>
  );
}

function ProfileName({ uid }: { uid: string }) {
  const profile = useDoc<PublicProfile>(`publicProfiles/${uid}`, [uid]);
  return <span className="font-semibold">{profile.data?.anonUsername ?? "A student"}</span>;
}

function PairCard({ uid, pair, partner }: { uid: string; pair: BuddyPairDoc; partner: PublicProfile }) {
  const [modal, setModal] = useState<"unmatch" | "block" | "report" | null>(null);
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const unmatch = useAction(async () => { await api.unmatchBuddy({}); setModal(null); });
  const block = useAction(async () => {
    await setDoc(doc(db, `blocks/${uid}/users/${partner.uid}`), { blockedUid: partner.uid, createdAt: serverTimestamp() });
    await api.unmatchBuddy({});
    setModal(null);
  });
  const report = useAction(async () => {
    const id = newId().slice(0, 20);
    await setDoc(doc(db, "reports", id), { id, reporterId: uid, targetType: "buddy", targetId: partner.uid, groupId: null, reason, details: details.slice(0, 1000), status: "open", createdAt: serverTimestamp() });
    setModal(null);
    setDetails("");
  });
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Your Buddy since {timeAgo(pair.createdAt)}</p>
          <h2 className="text-2xl font-bold">{partner.anonUsername}</h2>
          <p className="text-sm text-ink-500">Class {partner.classLevel} · {GOAL_LABELS[partner.goal]} · {LEARNING_LEVEL_LABELS[partner.learningLevel]} · {partner.subjects.map((subject) => SUBJECT_NAMES[subject]).join(", ")}</p>
          <p className="mt-1 text-xs text-ink-500">{partner.progressSummary.questionsSolved} questions solved · {partner.progressSummary.lessonsCompleted} lessons</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setModal("unmatch")}>Unmatch</button>
          <button type="button" className="btn-secondary" onClick={() => setModal("report")}>Report</button>
          <button type="button" className="btn-danger" onClick={() => setModal("block")}>Block</button>
        </div>
      </div>
      <Modal open={modal === "unmatch"} title="Unmatch" onClose={() => setModal(null)}>
        <p className="text-sm">End this Buddy pair? You can find a new Buddy afterwards. Your session history stays.</p>
        <InlineError message={unmatch.error} />
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn-primary" disabled={unmatch.busy} onClick={() => void unmatch.run()}>Unmatch</button></div>
      </Modal>
      <Modal open={modal === "block"} title="Block" onClose={() => setModal(null)}>
        <p className="text-sm">Blocking ends the pair and hides you from {partner.anonUsername} in matching, both ways. They are not told.</p>
        <InlineError message={block.error} />
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn-danger" disabled={block.busy} onClick={() => void block.run()}>Block</button></div>
      </Modal>
      <Modal open={modal === "report"} title="Report" onClose={() => setModal(null)}>
        <label className="block text-sm"><span className="label">Reason</span><select className="input" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>{REPORT_REASONS.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
        <label className="mt-2 block text-sm"><span className="label">What happened</span><textarea className="input" rows={3} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
        <p className="mt-2 text-xs text-ink-500">Reports go to EduOrbit moderators. The reported student is not told who reported them.</p>
        <InlineError message={report.error} />
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn-primary" disabled={report.busy} onClick={() => void report.run()}>Send report</button></div>
      </Modal>
    </section>
  );
}

function StudyRoom({ uid, pair, partner, onRewards }: { uid: string; pair: BuddyPairDoc; partner: PublicProfile; onRewards: (rewards: OutcomeResult | null) => void }) {
  const live = useDoc<BuddySessionDoc>(`buddySessions/${pair.id}_live`, [pair.id]);
  const [now, setNow] = useState(Date.now());
  const [historyVersion, setHistoryVersion] = useState(0);
  const act = useAction(async (action: RoomAction) => {
    const result = await api.buddyRoomAction({ action });
    live.reload();
    if (action === "stop") {
      onRewards(result.credited[uid]?.rewards ?? null);
      setHistoryVersion((value) => value + 1);
    }
    return result;
  });
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    const poll = setInterval(() => live.reload(), 5000);
    return () => { clearInterval(timer); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair.id]);
  useEffect(() => {
    if (live.data && !live.data.participants[uid]?.present && live.data.status !== "stopped") void api.buddyRoomAction({ action: "join" }).then(() => live.reload()).catch((error) => console.error("Could not join the room", error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data?.status]);
  const session = live.data;
  const total = session ? runningSeconds(session, now) : 0;
  const seconds = (member: string) => {
    const entry = session?.participants[member];
    if (!entry) return 0;
    const resumedMs = session?.status === "running" ? toDate(session.resumedAt)?.getTime() ?? null : null;
    return entry.seconds + (entry.present && resumedMs !== null ? Math.max(0, Math.floor((now - resumedMs) / 1000)) : 0);
  };
  const status = session?.status ?? "idle";
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card lg:col-span-2">
        <p className="text-xs uppercase tracking-wide text-ink-500">Shared timer with {partner.anonUsername}</p>
        <p className="mt-1 font-mono text-5xl font-bold" aria-live="off">{formatDuration(total)}</p>
        <p className="mt-1 text-sm text-ink-500">Status: {status}{session?.participants[partner.uid]?.present ? ` · ${partner.anonUsername} is here` : ` · ${partner.anonUsername} has not joined`}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(status === "idle" || status === "stopped") && <button type="button" className="btn-primary" disabled={act.busy} onClick={() => void act.run("start")}>Start</button>}
          {status === "running" && <button type="button" className="btn-secondary" disabled={act.busy} onClick={() => void act.run("pause")}>Pause</button>}
          {status === "paused" && <button type="button" className="btn-primary" disabled={act.busy} onClick={() => void act.run("resume")}>Resume</button>}
          {(status === "running" || status === "paused") && <button type="button" className="btn-secondary" disabled={act.busy} onClick={() => void act.run("stop")}>Stop and save</button>}
          {status !== "running" && <button type="button" className="btn-ghost" disabled={act.busy} onClick={() => void act.run("reset")}>Reset</button>}
          {session?.participants[uid]?.present ? <button type="button" className="btn-ghost" disabled={act.busy} onClick={() => void act.run("leave")}>Step out</button> : <button type="button" className="btn-ghost" disabled={act.busy} onClick={() => void act.run("join")}>Join</button>}
        </div>
        <InlineError message={act.error} />
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-ink-100 p-3"><dt className="text-ink-500">Your time</dt><dd className="font-mono text-xl font-semibold">{formatDuration(seconds(uid))}</dd></div>
          <div className="rounded-lg bg-ink-100 p-3"><dt className="text-ink-500">{partner.anonUsername}</dt><dd className="font-mono text-xl font-semibold">{formatDuration(seconds(partner.uid))}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-500">Stop saves each student's whole minutes as a Buddy study session (up to 60 per session) and counts toward streaks. Time is measured on the server.</p>
      </section>
      <SessionHistory pair={pair} uid={uid} partnerName={partner.anonUsername} version={historyVersion} />
    </div>
  );
}

function SessionHistory({ pair, uid, partnerName, version = 0 }: { pair: BuddyPairDoc; uid: string; partnerName: string; version?: number }) {
  const history = useQueryOnce<BuddySessionDoc>(() => query(collection(db, "buddySessions"), where("pairId", "==", pair.id), where("status", "==", "stopped"), orderBy("finalizedAt", "desc")), [pair.id, version]);
  const rows = history.data.filter((row) => row.finalizedAt);
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Session history</h2>
      <AsyncState loading={history.loading} error={history.error} empty={rows.length === 0} emptyTitle="No sessions yet" emptyBody="Stop a room session to record it here." skeletonLines={2}>
        <ul className="mt-2 divide-y divide-ink-200 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="py-2">
              <p className="font-medium">{formatDuration(row.accumulatedSec)} <span className="text-ink-500">· {timeAgo(row.finalizedAt)}</span></p>
              <p className="text-xs text-ink-500">You {formatDuration(row.participants[uid]?.seconds ?? 0)} · {partnerName} {formatDuration(Object.entries(row.participants).find(([member]) => member !== uid)?.[1].seconds ?? 0)}</p>
            </li>
          ))}
        </ul>
      </AsyncState>
    </section>
  );
}

function Challenges({ uid, pair, partner, onRewards }: { uid: string; pair: BuddyPairDoc; partner: PublicProfile; onRewards: (rewards: OutcomeResult | null) => void }) {
  const challenges = useLiveQuery<BuddyChallengeDoc>(() => query(collection(db, "buddyChallenges"), where("pairId", "==", pair.id), orderBy("createdAt", "desc")), [pair.id]);
  const [kind, setKind] = useState<ChallengeKind>("questions");
  const [target, setTarget] = useState(20);
  const bounds = CHALLENGE_TARGETS[kind];
  useEffect(() => setTarget(Math.max(bounds.min, Math.min(bounds.max, target))), [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useAction(async () => api.createBuddyChallenge({ kind, target, days: 7 }));
  const refresh = useAction(async (challengeId: string) => {
    const result = await api.refreshBuddyChallenge({ challengeId });
    if (result.rewarded.includes(uid)) onRewards({ xp: 150, coins: 20, streak: { current: 0, longest: 0, incremented: false, protectionUsed: false, milestones: [], qualifiedToday: false }, badges: [] });
    return result;
  });
  const active = useMemo(() => challenges.data.filter((challenge) => !challenge.completed), [challenges.data]);
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Challenges</h2>
      <p className="text-sm text-ink-500">Both of you must reach the target within seven days. Progress comes from real activity; rewards are paid once to each of you.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void create.run(); }}>
        <label className="text-sm"><span className="label">Kind</span><select className="input" value={kind} onChange={(event) => setKind(event.target.value as ChallengeKind)}>{(Object.keys(CHALLENGE_KIND_LABELS) as ChallengeKind[]).map((item) => <option key={item} value={item}>{CHALLENGE_KIND_LABELS[item]}</option>)}</select></label>
        <label className="text-sm"><span className="label">Target ({bounds.unit})</span><input className="input w-28" type="number" min={bounds.min} max={bounds.max} value={target} onChange={(event) => setTarget(Number(event.target.value) || bounds.min)} /></label>
        <button type="submit" className="btn-primary" disabled={create.busy}>Create</button>
      </form>
      <InlineError message={create.error ?? refresh.error} />
      <AsyncState loading={challenges.loading} error={challenges.error} empty={challenges.data.length === 0} emptyTitle="No challenges yet" emptyBody="Create one to study toward a shared goal." skeletonLines={2}>
        <ul className="mt-3 space-y-3">
          {[...active, ...challenges.data.filter((challenge) => challenge.completed)].map((challenge) => (
            <li key={challenge.id} className="rounded-xl border border-ink-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{challenge.title} {challenge.completed && <Tag tone="success">Completed</Tag>}</p>
                {!challenge.completed && <button type="button" className="btn-secondary py-1" disabled={refresh.busy} onClick={() => void refresh.run(challenge.id)}>Refresh progress</button>}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ProgressBar value={((challenge.progress[uid] ?? 0) / challenge.target) * 100} label={`You: ${challenge.progress[uid] ?? 0} / ${challenge.target}`} tone={challenge.completed ? "success" : "brand"} />
                <ProgressBar value={((challenge.progress[partner.uid] ?? 0) / challenge.target) * 100} label={`${partner.anonUsername}: ${challenge.progress[partner.uid] ?? 0} / ${challenge.target}`} tone={challenge.completed ? "success" : "brand"} />
              </div>
              <p className="mt-1 text-xs text-ink-500">Ends {toDate(challenge.endsAt)?.toLocaleDateString("en-IN") ?? ""}</p>
            </li>
          ))}
        </ul>
      </AsyncState>
    </section>
  );
}
