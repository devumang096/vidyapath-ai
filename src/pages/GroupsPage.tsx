import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { api, type GroupInput, type RoomAction } from "../lib/callables";
import { db } from "../lib/firebase";
import { formatDuration, timeAgo, toDate } from "../lib/format";
import { CLASS_LEVELS, SUBJECT_IDS, SUBJECT_NAMES, SUBJECTS_BY_PATH } from "../lib/subjects";
import { useAction, useDoc, useLiveQuery, useQueryOnce } from "../hooks/useFirestore";
import { CHALLENGE_TARGETS, runningSeconds } from "../../functions/src/lib/buddy.js";
import { AsyncState, InlineError, Modal, PageHeader, ProgressBar, RewardToast, Tabs, Tag } from "../components/ui";
import type { OutcomeResult } from "../lib/callables";
import {
  CHALLENGE_KIND_LABELS, GROUP_COVERS, GROUP_FOCUS_LABELS, REACTIONS,
  type ChallengeKind, type ClassLevel, type GroupChallengeDoc, type GroupDoc, type GroupFocus, type GroupInvitationDoc, type GroupInviteCodeDoc, type GroupJoinRequestDoc, type GroupMemberDoc,
  type GroupPostDoc, type GroupPostReactionDoc, type GroupReplyDoc, type GroupReportDoc, type GroupRole, type GroupSessionDoc, type LearningPath, type ReportReason, type SubjectId
} from "../lib/types";

const COVER_STYLE: Record<string, string> = { orbit: "from-brand-500 to-brand-700", atom: "from-sky-500 to-indigo-600", leaf: "from-emerald-500 to-teal-700", sigma: "from-amber-500 to-orange-600", flask: "from-fuchsia-500 to-purple-700", spark: "from-rose-500 to-red-600" };
const REPORT_REASONS: ReportReason[] = ["harassment", "inappropriate", "contact_sharing", "spam", "abuse", "irrelevant", "other"];

export default function GroupsPage({ view = "list" }: { view?: "list" | "create" | "detail" | "discussion" }) {
  if (view === "create") return <CreateGroup />;
  if (view === "detail" || view === "discussion") return <GroupDetail discussion={view === "discussion"} />;
  return <GroupList />;
}

function Cover({ cover, size = "h-16" }: { cover: string; size?: string }) {
  return <div aria-hidden="true" className={`${size} w-full rounded-t-xl bg-gradient-to-br ${COVER_STYLE[cover] ?? COVER_STYLE.orbit}`} />;
}

function describe(group: GroupDoc): string {
  const parts = [GROUP_FOCUS_LABELS[group.focus]];
  if (group.classLevel) parts.push(`Class ${group.classLevel}`);
  if (group.path && group.path !== "school") parts.push(group.path.toUpperCase());
  if (group.subjectId) parts.push(SUBJECT_NAMES[group.subjectId]);
  return parts.join(" · ");
}

/** My groups, public discovery, join by code and pending invitations. */
function GroupList() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const memberships = useLiveQuery<GroupMemberDoc>(() => (uid ? query(collection(db, "groupMembers"), where("uid", "==", uid)) : null), [uid]);
  const invitations = useLiveQuery<GroupInvitationDoc>(() => (uid ? query(collection(db, "groupInvitations"), where("toUid", "==", uid), where("status", "==", "pending")) : null), [uid]);
  const discover = useQueryOnce<GroupDoc>(() => query(collection(db, "groups"), where("privacy", "==", "public"), where("status", "==", "active"), orderBy("memberCount", "desc"), limit(30)), []);
  const mineIds = useMemo(() => new Set(memberships.data.map((row) => row.groupId)), [memberships.data]);
  const mine = useContent(async () => Promise.all([...mineIds].map(async (groupId) => (await import("firebase/firestore")).getDoc((await import("firebase/firestore")).doc(db, "groups", groupId)).then((snap) => (snap.exists() ? (snap.data() as GroupDoc) : null)))), [mineIds.size]);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const join = useAction(async () => {
    const result = await api.joinGroupWithCode({ code: code.trim() });
    navigate(`/groups/${result.groupId}`);
    return result;
  });
  const request = useAction(async (groupId: string) => api.requestJoinGroup({ groupId, message: "" }));
  const respond = useAction(async (invitationId: string, accept: boolean) => {
    const result = await api.respondGroupInvitation({ invitationId, accept });
    if (accept) navigate(`/groups/${result.groupId}`);
    return result;
  });
  const [requested, setRequested] = useState<Set<string>>(new Set());

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Groups" subtitle="Study together around a class, exam, subject, chapter, project or goal." action={<Link to="/groups/create" className="btn-primary">Create group</Link>} />
      {invitations.data.length > 0 && (
        <section className="card mb-4">
          <h2 className="text-lg font-semibold">Invitations</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
                <span>You were invited to join <span className="font-semibold">{invitation.groupName}</span> <span className="text-ink-500">· {timeAgo(invitation.createdAt)}</span></span>
                <span className="flex gap-2"><button type="button" className="btn-primary py-1" disabled={respond.busy} onClick={() => void respond.run(invitation.id, true)}>Accept</button><button type="button" className="btn-secondary py-1" disabled={respond.busy} onClick={() => void respond.run(invitation.id, false)}>Decline</button></span>
              </li>
            ))}
          </ul>
          <InlineError message={respond.error} />
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section>
            <h2 className="mb-2 text-lg font-semibold">My groups</h2>
            <AsyncState loading={memberships.loading || mine.loading} error={memberships.error ?? mine.error} empty={mineIds.size === 0} emptyTitle="Join a study group or create one to learn together." emptyBody="Discover public groups below, enter an invite code, or create your own." skeletonLines={2}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {(mine.data ?? []).filter((group): group is GroupDoc => Boolean(group)).map((group) => <GroupCard key={group.id} group={group} role={memberships.data.find((row) => row.groupId === group.id)?.role ?? null} />)}
              </ul>
            </AsyncState>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Discover public groups</h2>
            <AsyncState loading={discover.loading} error={discover.error} onRetry={discover.reload} empty={discover.data.filter((group) => !mineIds.has(group.id)).length === 0} emptyTitle="No other public groups yet" emptyBody="Create one and invite classmates." skeletonLines={2}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {discover.data.filter((group) => !mineIds.has(group.id)).map((group) => (
                  <li key={group.id} className="card overflow-hidden p-0">
                    <Cover cover={group.cover} />
                    <div className="p-4">
                      <p className="font-semibold">{group.name}</p>
                      <p className="text-xs text-ink-500">{describe(group)} · {group.memberCount}/{group.maxMembers} members</p>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-700">{group.description}</p>
                      <button type="button" className="btn-primary mt-3" disabled={request.busy || requested.has(group.id) || group.memberCount >= group.maxMembers} onClick={() => void request.run(group.id).then((result) => { if (result) setRequested((previous) => new Set(previous).add(group.id)); })}>{requested.has(group.id) ? "Requested" : group.memberCount >= group.maxMembers ? "Full" : "Request to join"}</button>
                    </div>
                  </li>
                ))}
              </ul>
              <InlineError message={request.error} />
            </AsyncState>
          </section>
        </div>
        <aside className="space-y-4">
          <form className="card" onSubmit={(event) => { event.preventDefault(); void join.run(); }}>
            <h2 className="text-lg font-semibold">Join with a code</h2>
            <p className="text-sm text-ink-500">Codes look like EDU-7K4P9 and are checked on the server for expiry, usage limit and revocation.</p>
            <label className="mt-3 block text-sm"><span className="label">Invite code</span><input className="input font-mono uppercase" value={code} maxLength={12} onChange={(event) => setCode(event.target.value)} placeholder="EDU-XXXXX" /></label>
            <InlineError message={join.error} />
            <button type="submit" className="btn-primary mt-3" disabled={join.busy || code.trim().length < 6}>Join</button>
          </form>
          <section className="card text-sm text-ink-700">
            <h2 className="text-lg font-semibold">How groups work</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Public groups: request to join, an owner or admin approves.</li>
              <li>Private groups: join with an invite code or an in-app invitation.</li>
              <li>Roles: owner, admin, member. Roles are set only by the owner, on the server.</li>
              <li>Posts that look like phone numbers, emails or handles are refused.</li>
            </ul>
            <Link to="/guidelines" className="mt-2 inline-block text-brand-600 hover:underline">Community guidelines</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

function GroupCard({ group, role }: { group: GroupDoc; role: GroupRole | null }) {
  return (
    <li className="card overflow-hidden p-0">
      <Link to={`/groups/${group.id}`} className="block hover:bg-ink-100">
        <Cover cover={group.cover} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{group.name}</p>
            {role && <Tag tone={role === "owner" ? "brand" : "neutral"}>{role}</Tag>}
          </div>
          <p className="text-xs text-ink-500">{describe(group)} · {group.memberCount} members · {group.privacy}</p>
        </div>
      </Link>
    </li>
  );
}

function GroupForm({ initial, onSubmit, busy, error, submitLabel }: { initial: GroupInput; onSubmit: (fields: GroupInput) => void; busy: boolean; error: string | null; submitLabel: string }) {
  const [form, setForm] = useState<GroupInput>(initial);
  const subjects = form.path ? SUBJECTS_BY_PATH[form.path] : SUBJECT_IDS;
  const chapters = useContent(() => (form.subjectId && form.classLevel ? content.chapters(form.classLevel, form.subjectId) : Promise.resolve([])), [form.subjectId, form.classLevel]);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ ...form, subjectId: form.subjectId && subjects.includes(form.subjectId) ? form.subjectId : null });
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2"><span className="label">Group name</span><input className="input" required minLength={3} maxLength={60} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="block text-sm sm:col-span-2"><span className="label">Description</span><textarea className="input" rows={2} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="block text-sm"><span className="label">Group type</span><select className="input" value={form.focus} onChange={(event) => setForm({ ...form, focus: event.target.value as GroupFocus })}>{(Object.keys(GROUP_FOCUS_LABELS) as GroupFocus[]).map((focus) => <option key={focus} value={focus}>{GROUP_FOCUS_LABELS[focus]}</option>)}</select></label>
        <label className="block text-sm"><span className="label">Privacy</span><select className="input" value={form.privacy} onChange={(event) => setForm({ ...form, privacy: event.target.value as "public" | "private" })}><option value="public">Public (discoverable, join by request)</option><option value="private">Private (invite or code only)</option></select></label>
        <label className="block text-sm"><span className="label">Class</span><select className="input" value={form.classLevel ?? ""} onChange={(event) => setForm({ ...form, classLevel: event.target.value ? (Number(event.target.value) as ClassLevel) : null, chapterId: null })}><option value="">Any</option>{CLASS_LEVELS.map((level) => <option key={level} value={level}>Class {level}</option>)}</select></label>
        <label className="block text-sm"><span className="label">Learning path</span><select className="input" value={form.path ?? ""} onChange={(event) => setForm({ ...form, path: (event.target.value || null) as LearningPath | null })}><option value="">Any</option><option value="school">School</option><option value="jee">JEE</option><option value="neet">NEET</option></select></label>
        <label className="block text-sm"><span className="label">Subject</span><select className="input" value={form.subjectId ?? ""} onChange={(event) => setForm({ ...form, subjectId: (event.target.value || null) as SubjectId | null, chapterId: null })}><option value="">Any</option>{subjects.map((subject) => <option key={subject} value={subject}>{SUBJECT_NAMES[subject]}</option>)}</select></label>
        <label className="block text-sm"><span className="label">Chapter (optional)</span><select className="input" value={form.chapterId ?? ""} disabled={!form.subjectId || !form.classLevel} onChange={(event) => setForm({ ...form, chapterId: event.target.value || null })}><option value="">{form.subjectId && form.classLevel ? "Whole subject" : "Pick class and subject"}</option>{(chapters.data ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></label>
        <label className="block text-sm"><span className="label">Maximum members</span><input className="input" type="number" min={2} max={50} value={form.maxMembers} onChange={(event) => setForm({ ...form, maxMembers: Number(event.target.value) || 2 })} /></label>
        <label className="block text-sm"><span className="label">Cover</span><select className="input" value={form.cover} onChange={(event) => setForm({ ...form, cover: event.target.value })}>{GROUP_COVERS.map((cover) => <option key={cover} value={cover}>{cover}</option>)}</select></label>
        <label className="block text-sm sm:col-span-2"><span className="label">Study goal</span><input className="input" maxLength={200} value={form.studyGoal} onChange={(event) => setForm({ ...form, studyGoal: event.target.value })} /></label>
        <label className="block text-sm sm:col-span-2"><span className="label">Group rules</span><textarea className="input" rows={2} maxLength={500} value={form.rules} onChange={(event) => setForm({ ...form, rules: event.target.value })} /></label>
      </div>
      <InlineError message={error} />
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving..." : submitLabel}</button>
    </form>
  );
}

function CreateGroup() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const create = useAction(async (fields: GroupInput) => {
    const result = await api.createGroup(fields);
    navigate(`/groups/${result.groupId}`);
    return result;
  });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create group" subtitle="You become the owner. Owners approve requests, manage members and codes, and moderate." crumbs={[{ label: "Groups", to: "/groups" }]} />
      <GroupForm initial={{ name: "", description: "", privacy: "public", focus: "subject", classLevel: profile?.classLevel ?? null, path: null, subjectId: profile?.subjects[0] ?? null, chapterId: null, studyGoal: "", rules: "", maxMembers: 20, cover: "orbit" }} onSubmit={(fields) => void create.run(fields)} busy={create.busy} error={create.error} submitLabel="Create group" />
    </div>
  );
}

function GroupDetail({ discussion }: { discussion: boolean }) {
  const { groupId = "" } = useParams();
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const group = useDoc<GroupDoc>(`groups/${groupId}`, [groupId]);
  const member = useDoc<GroupMemberDoc>(uid ? `groupMembers/${groupId}_${uid}` : null, [groupId, uid]);
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const navigate = useNavigate();
  const request = useAction(async () => api.requestJoinGroup({ groupId, message: "" }));
  const [requested, setRequested] = useState(false);
  const staff = member.data?.role === "owner" || member.data?.role === "admin";

  return (
    <div className="mx-auto max-w-5xl">
      <AsyncState loading={group.loading || member.loading} error={group.error ?? member.error} empty={!group.loading && !group.data} emptyTitle="Group not found" emptyBody="It may be private, archived or deleted." emptyAction={<Link to="/groups" className="btn-secondary">Back to groups</Link>}>
        {group.data && (
          <>
            <div className="card overflow-hidden p-0">
              <Cover cover={group.data.cover} size="h-24" />
              <div className="p-5">
                <PageHeader title={group.data.name} subtitle={`${describe(group.data)} · ${group.data.memberCount}/${group.data.maxMembers} members · ${group.data.privacy}`} crumbs={[{ label: "Groups", to: "/groups" }]} action={member.data ? <span className="flex items-center gap-2"><Tag tone={member.data.role === "owner" ? "brand" : "neutral"}>{member.data.role}</Tag>{staff && <Link to={`/groups/${groupId}?edit=1`} className="btn-secondary" onClick={(event) => { event.preventDefault(); navigate(`/groups/${groupId}`, { state: { edit: true } }); }}>Edit</Link>}</span> : null} />
                <p className="-mt-3 text-sm text-ink-700">{group.data.description}</p>
                {group.data.studyGoal && <p className="mt-2 text-sm"><span className="font-semibold">Goal: </span>{group.data.studyGoal}</p>}
                {group.data.rules && <p className="mt-1 text-sm"><span className="font-semibold">Rules: </span>{group.data.rules}</p>}
                {!member.data && (
                  <div className="mt-3">
                    {group.data.privacy === "public" ? <button type="button" className="btn-primary" disabled={request.busy || requested} onClick={() => void request.run().then((result) => { if (result) setRequested(true); })}>{requested ? "Request sent" : "Request to join"}</button> : <p className="text-sm text-ink-500">This group is private. Join with an invite code or an invitation.</p>}
                    <InlineError message={request.error} />
                  </div>
                )}
              </div>
            </div>
            {member.data && (
              <>
                <div className="mt-4">
                  <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "discussion", label: "Discussion" }]} value={discussion ? "discussion" : "overview"} onChange={(next) => navigate(next === "discussion" ? `/groups/${groupId}/discussion` : `/groups/${groupId}`)} />
                </div>
                {discussion ? (
                  <Discussion group={group.data} member={member.data} uid={uid} />
                ) : (
                  <Overview group={group.data} member={member.data} uid={uid} staff={staff} onRewards={setToast} onChanged={() => { group.reload(); member.reload(); }} />
                )}
              </>
            )}
          </>
        )}
      </AsyncState>
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Overview({ group, member, uid, staff, onRewards, onChanged }: { group: GroupDoc; member: GroupMemberDoc; uid: string; staff: boolean; onRewards: (rewards: OutcomeResult | null) => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const update = useAction(async (fields: GroupInput) => {
    await api.updateGroup({ ...fields, groupId: group.id });
    setEditing(false);
    onChanged();
  });
  const leave = useAction(async () => {
    await api.leaveGroup({ groupId: group.id });
    navigate("/groups");
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {staff && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit group"}</button>
          </div>
        )}
        {editing && <GroupForm initial={{ name: group.name, description: group.description, privacy: group.privacy, focus: group.focus, classLevel: group.classLevel, path: group.path, subjectId: group.subjectId, chapterId: group.chapterId, studyGoal: group.studyGoal, rules: group.rules, maxMembers: group.maxMembers, cover: group.cover }} onSubmit={(fields) => void update.run(fields)} busy={update.busy} error={update.error} submitLabel="Save changes" />}
        <Announcements group={group} />
        <Members group={group} member={member} uid={uid} staff={staff} onChanged={onChanged} />
        {staff && <JoinRequests group={group} />}
        <Challenges group={group} member={member} uid={uid} staff={staff} onRewards={onRewards} />
      </div>
      <aside className="space-y-4">
        <GroupSession group={group} uid={uid} onRewards={onRewards} />
        {staff && <InviteTools group={group} />}
        <Resources group={group} staff={staff} onChanged={onChanged} />
        <section className="card">
          <h2 className="text-lg font-semibold">Leave group</h2>
          <p className="mt-1 text-sm text-ink-500">{member.role === "owner" ? "Ownership passes to the earliest admin or member. If you are the last member, the group is archived." : "You can request or be invited again later."}</p>
          <button type="button" className="btn-danger mt-3" disabled={leave.busy} onClick={() => { if (window.confirm("Leave this group?")) void leave.run(); }}>Leave</button>
          <InlineError message={leave.error} />
        </section>
      </aside>
    </div>
  );
}

function Announcements({ group }: { group: GroupDoc }) {
  const posts = useQueryOnce<GroupPostDoc>(() => query(collection(db, "groupPosts"), where("groupId", "==", group.id), where("kind", "==", "announcement"), where("hidden", "==", false), orderBy("createdAt", "desc"), limit(3)), [group.id]);
  if (posts.data.length === 0) return null;
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Announcements</h2>
      <ul className="mt-2 space-y-2 text-sm">{posts.data.map((post) => <li key={post.id} className="rounded-lg bg-brand-50 p-3"><p className="font-semibold">{post.title}</p><p className="text-ink-700">{post.body}</p><p className="mt-1 text-xs text-ink-500">{post.authorName} · {timeAgo(post.createdAt)}</p></li>)}</ul>
    </section>
  );
}

function Members({ group, member, uid, staff, onChanged }: { group: GroupDoc; member: GroupMemberDoc; uid: string; staff: boolean; onChanged: () => void }) {
  const members = useLiveQuery<GroupMemberDoc>(() => query(collection(db, "groupMembers"), where("groupId", "==", group.id)), [group.id]);
  const remove = useAction(async (targetUid: string) => { await api.removeGroupMember({ groupId: group.id, targetUid }); onChanged(); });
  const setRole = useAction(async (targetUid: string, role: GroupRole) => { await api.setGroupRole({ groupId: group.id, targetUid, role }); onChanged(); });
  const [reportTarget, setReportTarget] = useState<GroupMemberDoc | null>(null);
  const sorted = [...members.data].sort((left, right) => ["owner", "admin", "member"].indexOf(left.role) - ["owner", "admin", "member"].indexOf(right.role));
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Members ({group.memberCount})</h2>
      <AsyncState loading={members.loading} error={members.error} skeletonLines={2}>
        <ul className="mt-2 divide-y divide-ink-200 text-sm">
          {sorted.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{row.anonUsername}</span>{row.uid === uid ? " (you)" : ""} <Tag tone={row.role === "owner" ? "brand" : row.role === "admin" ? "success" : "neutral"}>{row.role}</Tag></span>
              <span className="flex flex-wrap gap-1">
                {member.role === "owner" && row.uid !== uid && (
                  <select className="input w-32 py-1" aria-label={`Role for ${row.anonUsername}`} value={row.role} disabled={setRole.busy} onChange={(event) => void setRole.run(row.uid, event.target.value as GroupRole)}>
                    <option value="member">member</option><option value="admin">admin</option><option value="owner">owner (transfer)</option>
                  </select>
                )}
                {staff && row.uid !== uid && row.role !== "owner" && !(member.role === "admin" && row.role === "admin") && <button type="button" className="btn-ghost py-1 text-xs" disabled={remove.busy} onClick={() => { if (window.confirm(`Remove ${row.anonUsername}?`)) void remove.run(row.uid); }}>Remove</button>}
                {row.uid !== uid && <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setReportTarget(row)}>Report</button>}
              </span>
            </li>
          ))}
        </ul>
      </AsyncState>
      <InlineError message={remove.error ?? setRole.error} />
      <ReportModal group={group} target={reportTarget ? { type: "member", id: reportTarget.uid, label: reportTarget.anonUsername } : null} onClose={() => setReportTarget(null)} />
    </section>
  );
}

function ReportModal({ group, target, onClose }: { group: GroupDoc; target: { type: "post" | "reply" | "member"; id: string; label: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("inappropriate");
  const [details, setDetails] = useState("");
  const report = useAction(async () => {
    if (!target) return null;
    const result = await api.reportInGroup({ groupId: group.id, targetType: target.type, targetId: target.id, reason, details });
    setDetails("");
    onClose();
    return result;
  });
  return (
    <Modal open={Boolean(target)} title={`Report ${target?.label ?? ""}`} onClose={onClose}>
      <label className="block text-sm"><span className="label">Reason</span><select className="input" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>{REPORT_REASONS.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
      <label className="mt-2 block text-sm"><span className="label">Details</span><textarea className="input" rows={3} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <p className="mt-2 text-xs text-ink-500">Group owners, admins and EduOrbit moderators can see this report. The reported person is not told who reported them.</p>
      <InlineError message={report.error} />
      <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={report.busy} onClick={() => void report.run()}>Send report</button></div>
    </Modal>
  );
}

function JoinRequests({ group }: { group: GroupDoc }) {
  const requests = useLiveQuery<GroupJoinRequestDoc>(() => query(collection(db, "groupJoinRequests"), where("groupId", "==", group.id), where("status", "==", "pending")), [group.id]);
  const reports = useLiveQuery<GroupReportDoc>(() => query(collection(db, "groupReports"), where("groupId", "==", group.id), where("status", "==", "open")), [group.id]);
  const respond = useAction(async (requestId: string, approve: boolean) => api.respondJoinRequest({ requestId, approve }));
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Requests and reports</h2>
      <AsyncState loading={requests.loading} error={requests.error} skeletonLines={1}>
        <ul className="mt-2 space-y-2 text-sm">
          {requests.data.length === 0 && <li className="text-ink-500">No pending join requests.</li>}
          {requests.data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 p-3">
              <span><RequesterName uid={row.uid} /> wants to join{row.message ? `: "${row.message}"` : ""} <span className="text-ink-500">· {timeAgo(row.createdAt)}</span></span>
              <span className="flex gap-2"><button type="button" className="btn-primary py-1" disabled={respond.busy} onClick={() => void respond.run(row.id, true)}>Approve</button><button type="button" className="btn-secondary py-1" disabled={respond.busy} onClick={() => void respond.run(row.id, false)}>Reject</button></span>
            </li>
          ))}
        </ul>
      </AsyncState>
      {reports.data.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {reports.data.map((report) => <li key={report.id} className="rounded-lg bg-warn-500/10 p-2"><Tag tone="warn">{report.reason.replace(/_/g, " ")}</Tag> {report.targetType} {report.targetId.slice(0, 10)}… {report.details && <span className="text-ink-700">· {report.details}</span>}</li>)}
        </ul>
      )}
      <InlineError message={respond.error} />
    </section>
  );
}

function RequesterName({ uid }: { uid: string }) {
  const profile = useDoc<{ anonUsername: string }>(`publicProfiles/${uid}`, [uid]);
  return <span className="font-semibold">{profile.data?.anonUsername ?? "A student"}</span>;
}

function InviteTools({ group }: { group: GroupDoc }) {
  const codes = useLiveQuery<GroupInviteCodeDoc>(() => query(collection(db, "groupInviteCodes"), where("groupId", "==", group.id), orderBy("createdAt", "desc"), limit(10)), [group.id]);
  const [username, setUsername] = useState("");
  const create = useAction(async () => api.createGroupInviteCode({ groupId: group.id, expiresInHours: 72, maxUses: 10 }));
  const revoke = useAction(async (code: string) => api.revokeGroupInviteCode({ code }));
  const invite = useAction(async () => { const result = await api.inviteToGroup({ groupId: group.id, anonUsername: username.trim() }); setUsername(""); return result; });
  const [invited, setInvited] = useState<string | null>(null);
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Invite students</h2>
      <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void invite.run().then((result) => { if (result) setInvited(username.trim()); }); }}>
        <input className="input" placeholder="Anonymous username" value={username} onChange={(event) => setUsername(event.target.value)} aria-label="Anonymous username to invite" />
        <button type="submit" className="btn-primary" disabled={invite.busy || !username.trim()}>Invite</button>
      </form>
      {invited && <p className="mt-1 text-xs text-success-500">Invitation sent to {invited}.</p>}
      <InlineError message={invite.error} />
      <h3 className="mt-4 text-sm font-semibold">Invite codes</h3>
      <p className="text-xs text-ink-500">Each code lasts 72 hours and 10 uses. Revoke any time.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {codes.data.map((code) => {
          const expired = (toDate(code.expiresAt)?.getTime() ?? 0) < Date.now();
          return (
            <li key={code.id} className="flex items-center justify-between gap-2">
              <span className={`font-mono ${code.revoked || expired ? "text-ink-500 line-through" : ""}`}>{code.code}</span>
              <span className="text-xs text-ink-500">{code.uses}/{code.maxUses}{code.revoked ? " · revoked" : expired ? " · expired" : ""}</span>
              {!code.revoked && !expired && <button type="button" className="btn-ghost py-1 text-xs" disabled={revoke.busy} onClick={() => void revoke.run(code.code)}>Revoke</button>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn-secondary mt-2" disabled={create.busy} onClick={() => void create.run()}>New code</button>
      <InlineError message={create.error ?? revoke.error} />
    </section>
  );
}

function Resources({ group, staff, onChanged }: { group: GroupDoc; staff: boolean; onChanged: () => void }) {
  const [resource, setResource] = useState({ title: "", url: "" });
  const save = useAction(async (resources: { title: string; url: string }[]) => {
    await api.updateGroup({ groupId: group.id, name: group.name, description: group.description, privacy: group.privacy, focus: group.focus, classLevel: group.classLevel, path: group.path, subjectId: group.subjectId, chapterId: group.chapterId, studyGoal: group.studyGoal, rules: group.rules, maxMembers: group.maxMembers, cover: group.cover, resources });
    setResource({ title: "", url: "" });
    onChanged();
  });
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Resources</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {group.resources.length === 0 && <li className="text-ink-500">No resources yet.</li>}
        {group.resources.map((item, index) => (
          <li key={`${item.title}-${index}`} className="flex items-center justify-between gap-2">
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{item.title}</a> : <span>{item.title}</span>}
            {staff && <button type="button" className="btn-ghost py-1 text-xs" disabled={save.busy} onClick={() => void save.run(group.resources.filter((_, position) => position !== index))}>Remove</button>}
          </li>
        ))}
      </ul>
      {staff && (
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save.run([...group.resources, resource]); }}>
          <input className="input" placeholder="Title" maxLength={120} value={resource.title} onChange={(event) => setResource({ ...resource, title: event.target.value })} aria-label="Resource title" />
          <input className="input" placeholder="Link (optional)" type="url" value={resource.url} onChange={(event) => setResource({ ...resource, url: event.target.value })} aria-label="Resource link" />
          <button type="submit" className="btn-secondary" disabled={save.busy || !resource.title.trim()}>Add resource</button>
        </form>
      )}
      <InlineError message={save.error} />
    </section>
  );
}

function GroupSession({ group, uid, onRewards }: { group: GroupDoc; uid: string; onRewards: (rewards: OutcomeResult | null) => void }) {
  const live = useDoc<GroupSessionDoc>(`groupSessions/${group.id}_live`, [group.id]);
  const [now, setNow] = useState(Date.now());
  const [version, setVersion] = useState(0);
  const history = useQueryOnce<GroupSessionDoc>(() => query(collection(db, "groupSessions"), where("groupId", "==", group.id), where("status", "==", "stopped"), orderBy("finalizedAt", "desc"), limit(5)), [group.id, version]);
  const act = useAction(async (action: RoomAction) => {
    const result = await api.groupSessionAction({ groupId: group.id, action });
    live.reload();
    if (action === "stop") {
      onRewards(result.credited[uid]?.rewards ?? null);
      setVersion((value) => value + 1);
    }
    return result;
  });
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => live.reload(), 5000);
    return () => { clearInterval(tick); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);
  const session = live.data;
  const status = session?.status ?? "idle";
  const present = Object.values(session?.participants ?? {}).filter((entry) => entry.present).length;
  const mine = session?.participants[uid];
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Group study session</h2>
      <p className="mt-1 font-mono text-3xl font-bold">{formatDuration(session ? runningSeconds(session, now) : 0)}</p>
      <p className="text-xs text-ink-500">Status: {status} · {present} present{mine?.present ? " · you are in" : ""}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(status === "idle" || status === "stopped") && <button type="button" className="btn-primary py-1" disabled={act.busy} onClick={() => void act.run("start")}>Start</button>}
        {status === "running" && <button type="button" className="btn-secondary py-1" disabled={act.busy} onClick={() => void act.run("pause")}>Pause</button>}
        {status === "paused" && <button type="button" className="btn-primary py-1" disabled={act.busy} onClick={() => void act.run("resume")}>Resume</button>}
        {(status === "running" || status === "paused") && <button type="button" className="btn-secondary py-1" disabled={act.busy} onClick={() => void act.run("stop")}>Stop</button>}
        {mine?.present ? <button type="button" className="btn-ghost py-1" disabled={act.busy} onClick={() => void act.run("leave")}>Step out</button> : <button type="button" className="btn-ghost py-1" disabled={act.busy} onClick={() => void act.run("join")}>Join</button>}
      </div>
      <InlineError message={act.error} />
      {history.data.filter((row) => row.finalizedAt).length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-500">
          {history.data.filter((row) => row.finalizedAt).map((row) => <li key={row.id}>{formatDuration(row.accumulatedSec)} · {Object.keys(row.participants).length} took part · {timeAgo(row.finalizedAt)}</li>)}
        </ul>
      )}
    </section>
  );
}

function Challenges({ group, member, uid, staff, onRewards }: { group: GroupDoc; member: GroupMemberDoc; uid: string; staff: boolean; onRewards: (rewards: OutcomeResult | null) => void }) {
  const challenges = useLiveQuery<GroupChallengeDoc>(() => query(collection(db, "groupChallenges"), where("groupId", "==", group.id), orderBy("createdAt", "desc")), [group.id]);
  const [kind, setKind] = useState<ChallengeKind>("questions");
  const [target, setTarget] = useState(100);
  const create = useAction(async () => api.createGroupChallenge({ groupId: group.id, kind, target, days: 14 }));
  const refresh = useAction(async (challengeId: string) => {
    const result = await api.refreshGroupChallenge({ challengeId });
    if (result.rewarded.includes(uid)) onRewards({ xp: 150, coins: 20, streak: { current: 0, longest: 0, incremented: false, protectionUsed: false, milestones: [], qualifiedToday: false }, badges: [] });
    return result;
  });
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Group challenges</h2>
      <p className="text-sm text-ink-500">A shared total for the whole group, no leaderboard. Everyone who contributes is rewarded once when the group reaches the target.</p>
      {staff && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void create.run(); }}>
          <label className="text-sm"><span className="label">Kind</span><select className="input" value={kind} onChange={(event) => { const next = event.target.value as ChallengeKind; setKind(next); setTarget(CHALLENGE_TARGETS[next].min * 5); }}>{(Object.keys(CHALLENGE_KIND_LABELS) as ChallengeKind[]).map((item) => <option key={item} value={item}>{CHALLENGE_KIND_LABELS[item]}</option>)}</select></label>
          <label className="text-sm"><span className="label">Group target ({CHALLENGE_TARGETS[kind].unit})</span><input className="input w-28" type="number" min={CHALLENGE_TARGETS[kind].min} value={target} onChange={(event) => setTarget(Number(event.target.value) || CHALLENGE_TARGETS[kind].min)} /></label>
          <button type="submit" className="btn-primary" disabled={create.busy}>Create</button>
        </form>
      )}
      <InlineError message={create.error ?? refresh.error} />
      <AsyncState loading={challenges.loading} error={challenges.error} empty={challenges.data.length === 0} emptyTitle="No challenges yet" emptyBody={staff ? "Create one to give the group a shared goal." : "The owner or an admin can create one."} skeletonLines={2}>
        <ul className="mt-3 space-y-3">
          {challenges.data.map((challenge) => (
            <li key={challenge.id} className="rounded-xl border border-ink-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{challenge.title} {challenge.completed && <Tag tone="success">Completed</Tag>}</p>
                {!challenge.completed && <button type="button" className="btn-secondary py-1" disabled={refresh.busy} onClick={() => void refresh.run(challenge.id)}>Refresh progress</button>}
              </div>
              <div className="mt-2"><ProgressBar value={(challenge.totalProgress / challenge.target) * 100} label={`Group: ${challenge.totalProgress} / ${challenge.target}`} tone={challenge.completed ? "success" : "brand"} /></div>
              <p className="mt-1 text-xs text-ink-500">Your part: {challenge.progress[uid] ?? 0} · ends {toDate(challenge.endsAt)?.toLocaleDateString("en-IN") ?? ""}{member.role !== "member" ? "" : ""}</p>
            </li>
          ))}
        </ul>
      </AsyncState>
    </section>
  );
}

function Discussion({ group, member, uid }: { group: GroupDoc; member: GroupMemberDoc; uid: string }) {
  const posts = useLiveQuery<GroupPostDoc>(() => query(collection(db, "groupPosts"), where("groupId", "==", group.id), orderBy("createdAt", "desc"), limit(50)), [group.id]);
  const staff = member.role !== "member";
  const [kind, setKind] = useState<GroupPostDoc["kind"]>("post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = useAction(async () => { const result = await api.createGroupPost({ groupId: group.id, kind, title, body }); setTitle(""); setBody(""); return result; });
  const visible = posts.data.filter((post) => !post.hidden || staff || post.authorUid === uid);
  const [reportTarget, setReportTarget] = useState<{ type: "post" | "reply"; id: string; label: string } | null>(null);
  return (
    <div className="space-y-4">
      <form className="card space-y-2" onSubmit={(event) => { event.preventDefault(); void create.run(); }}>
        <div className="flex flex-wrap gap-2">
          <select className="input w-40" value={kind} onChange={(event) => setKind(event.target.value as GroupPostDoc["kind"])} aria-label="Post type"><option value="post">Post</option><option value="question">Question</option>{staff && <option value="announcement">Announcement</option>}</select>
          <input className="input flex-1" placeholder="Title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Post title" />
        </div>
        <textarea className="input" rows={3} maxLength={3000} placeholder="Write about the study topic. Phone numbers, emails, handles and links are refused." value={body} onChange={(event) => setBody(event.target.value)} aria-label="Post body" />
        <InlineError message={create.error} />
        <button type="submit" className="btn-primary" disabled={create.busy || title.trim().length < 3 || !body.trim()}>Post</button>
      </form>
      <AsyncState loading={posts.loading} error={posts.error} empty={visible.length === 0} emptyTitle="No posts yet" emptyBody="Start the discussion with a question about what you are studying." skeletonLines={3}>
        <ul className="space-y-3">
          {visible.map((post) => <PostCard key={post.id} post={post} uid={uid} staff={staff} onReport={(target) => setReportTarget(target)} />)}
        </ul>
      </AsyncState>
      <ReportModal group={group} target={reportTarget} onClose={() => setReportTarget(null)} />
    </div>
  );
}

function PostCard({ post, uid, staff, onReport }: { post: GroupPostDoc; uid: string; staff: boolean; onReport: (target: { type: "post" | "reply"; id: string; label: string }) => void }) {
  const [open, setOpen] = useState(false);
  const replies = useLiveQuery<GroupReplyDoc>(() => (open ? query(collection(db, "groupReplies"), where("postId", "==", post.id), orderBy("createdAt", "asc")) : null), [post.id, open]);
  const mine = useDoc<GroupPostReactionDoc>(`groupPostReactions/${post.id}_${uid}`, [post.id]);
  const [reply, setReply] = useState("");
  const react = useAction(async (emoji: string) => { const result = await api.reactToGroupPost({ postId: post.id, emoji }); mine.reload(); return result; });
  const helpful = useAction(async (targetType: "post" | "reply", targetId: string) => api.markGroupHelpful({ targetType, targetId }));
  const hide = useAction(async (targetType: "post" | "reply", targetId: string, hidden: boolean) => api.moderateGroupContent({ targetType, targetId, hidden }));
  const send = useAction(async () => { const result = await api.createGroupReply({ postId: post.id, body: reply }); setReply(""); setOpen(true); return result; });
  return (
    <li className={`card ${post.hidden ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag tone={post.kind === "announcement" ? "brand" : post.kind === "question" ? "warn" : "neutral"}>{post.kind}</Tag>
        <span className="font-semibold">{post.authorName}</span>
        <span className="text-ink-500">· {timeAgo(post.createdAt)}</span>
        {post.hidden && <Tag tone="danger">Hidden</Tag>}
      </div>
      <h3 className="mt-1 text-lg font-semibold">{post.title}</h3>
      <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{post.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {REACTIONS.map((emoji) => <button key={emoji} type="button" className={`rounded-full border px-2 py-0.5 ${mine.data?.emoji === emoji ? "border-brand-500 bg-brand-50" : "border-ink-200"}`} disabled={react.busy} onClick={() => void react.run(emoji)} aria-label={`React ${emoji}`}>{emoji} {post.reactions[emoji] ?? 0}</button>)}
        {post.authorUid !== uid && <button type="button" className={`btn-ghost py-1 text-xs ${post.helpfulBy.includes(uid) ? "font-bold" : ""}`} disabled={helpful.busy} onClick={() => void helpful.run("post", post.id)}>Helpful ({post.helpfulCount})</button>}
        <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen((value) => !value)}>{open ? "Hide replies" : `Replies (${post.replyCount})`}</button>
        {post.authorUid !== uid && <button type="button" className="btn-ghost py-1 text-xs" onClick={() => onReport({ type: "post", id: post.id, label: "this post" })}>Report</button>}
        {staff && <button type="button" className="btn-ghost py-1 text-xs" disabled={hide.busy} onClick={() => void hide.run("post", post.id, !post.hidden)}>{post.hidden ? "Unhide" : "Hide"}</button>}
      </div>
      <InlineError message={react.error ?? helpful.error ?? hide.error} />
      {open && (
        <div className="mt-3 border-t border-ink-200 pt-3">
          <ul className="space-y-2 text-sm">
            {replies.data.filter((row) => !row.hidden || staff || row.authorUid === uid).map((row) => (
              <li key={row.id} className={`rounded-lg bg-ink-100 p-3 ${row.hidden ? "opacity-60" : ""}`}>
                <p className="text-xs"><span className="font-semibold">{row.authorName}</span> <span className="text-ink-500">· {timeAgo(row.createdAt)}</span>{row.hidden && <Tag tone="danger">Hidden</Tag>}</p>
                <p className="mt-1 whitespace-pre-line text-ink-700">{row.body}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {row.authorUid !== uid && <button type="button" className="btn-ghost py-0.5 text-xs" disabled={helpful.busy} onClick={() => void helpful.run("reply", row.id)}>Helpful ({row.helpfulCount})</button>}
                  {row.authorUid !== uid && <button type="button" className="btn-ghost py-0.5 text-xs" onClick={() => onReport({ type: "reply", id: row.id, label: "this reply" })}>Report</button>}
                  {staff && <button type="button" className="btn-ghost py-0.5 text-xs" disabled={hide.busy} onClick={() => void hide.run("reply", row.id, !row.hidden)}>{row.hidden ? "Unhide" : "Hide"}</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!post.hidden && (
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void send.run(); }}>
          <input className="input" placeholder="Reply" maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} aria-label={`Reply to ${post.title}`} />
          <button type="submit" className="btn-secondary" disabled={send.busy || !reply.trim()}>Reply</button>
        </form>
      )}
      <InlineError message={send.error} />
    </li>
  );
}
