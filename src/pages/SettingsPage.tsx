import { useEffect, useState, type FormEvent } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { api, errorMessage } from "../lib/callables";
import { useAction } from "../hooks/useFirestore";
import { InlineError, Modal, PageHeader } from "../components/ui";
import { SUBJECT_NAMES, subjectsForGoal } from "../lib/subjects";
import { GOAL_LABELS, LEARNING_LEVEL_LABELS, type ClassLevel, type Goal, type Language, type LearningLevel, type NotificationPrefs, type SubjectId } from "../lib/types";

const PREF_LABELS: Record<keyof NotificationPrefs, string> = {
  streak: "Streak reminders",
  dailyGoal: "Daily goal reminders",
  weakTopic: "Weak topic detected",
  assessment: "New assessments",
  buddy: "Buddy requests and activity",
  group: "Group invitations and activity",
  reward: "Rewards and badges"
};

export default function SettingsPage() {
  const { user, profile, logout } = useAuth();
  const preferences = usePreferences();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", classLevel: 10 as ClassLevel, goal: "school" as Goal, subjects: [] as SubjectId[], language: "en" as Language, learningLevel: "beginner" as LearningLevel, dailyGoalMinutes: 60, school: "", phone: "", notificationPrefs: {} as NotificationPrefs });
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "" });
  const [passwordDone, setPasswordDone] = useState(false);

  useEffect(() => {
    if (profile) setForm({ name: profile.name, classLevel: profile.classLevel, goal: profile.goal, subjects: profile.subjects, language: profile.language, learningLevel: profile.learningLevel, dailyGoalMinutes: profile.dailyGoalMinutes, school: profile.school ?? "", phone: profile.phone ?? "", notificationPrefs: profile.notificationPrefs });
  }, [profile]);

  const allowed = subjectsForGoal(form.goal);
  const save = useAction(async () => {
    if (!user) return;
    if (form.name.trim().length < 1) throw new Error("Enter your name.");
    const subjects = form.subjects.filter((subject) => allowed.includes(subject));
    if (subjects.length === 0) throw new Error("Pick at least one subject.");
    await updateDoc(doc(db, "users", user.uid), {
      name: form.name.trim(), classLevel: form.classLevel, goal: form.goal, subjects, language: form.language, learningLevel: form.learningLevel, dailyGoalMinutes: form.dailyGoalMinutes,
      school: form.school.trim() || null, phone: form.phone.trim() || null, notificationPrefs: form.notificationPrefs, updatedAt: serverTimestamp()
    });
    setSaved(true);
  });
  const changePassword = useAction(async () => {
    if (!auth.currentUser?.email) throw new Error("Password change is only available for email accounts.");
    if (passwords.next.length < 6) throw new Error("New password must be at least 6 characters.");
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, passwords.current));
    await updatePassword(auth.currentUser, passwords.next);
    setPasswords({ current: "", next: "" });
    setPasswordDone(true);
  });
  const remove = useAction(async () => {
    await api.deleteAccount({});
    try {
      await logout();
    } catch (error) {
      console.error("Sign out after deletion failed", error);
    }
    navigate("/", { replace: true });
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    void save.run();
  }
  const isPasswordAccount = user?.providerData.some((provider) => provider.providerId === "password") ?? false;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Account, learning preferences, notifications, privacy and language." />
      <form onSubmit={onSubmit} className="card space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-ink-500">Signed in as {user?.email}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className="label">Full name</span><input className="input" maxLength={60} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="text-sm"><span className="label">School (optional)</span><input className="input" maxLength={120} value={form.school} onChange={(event) => setForm({ ...form, school: event.target.value })} /></label>
          <label className="text-sm"><span className="label">Phone (optional, private)</span><input className="input" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label className="text-sm"><span className="label">Class</span><select className="input" value={form.classLevel} onChange={(event) => setForm({ ...form, classLevel: Number(event.target.value) as ClassLevel })}>{[9, 10, 11, 12].map((level) => <option key={level} value={level}>Class {level}</option>)}</select></label>
          <label className="text-sm"><span className="label">Learning goal</span><select className="input" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value as Goal })}>{(Object.keys(GOAL_LABELS) as Goal[]).map((goal) => <option key={goal} value={goal}>{GOAL_LABELS[goal]}</option>)}</select></label>
          <label className="text-sm"><span className="label">Learning level</span><select className="input" value={form.learningLevel} onChange={(event) => setForm({ ...form, learningLevel: event.target.value as LearningLevel })}>{(Object.keys(LEARNING_LEVEL_LABELS) as LearningLevel[]).map((level) => <option key={level} value={level}>{LEARNING_LEVEL_LABELS[level]}</option>)}</select></label>
          <label className="text-sm"><span className="label">Daily study goal (minutes)</span><input className="input" type="number" min={15} max={720} value={form.dailyGoalMinutes} onChange={(event) => setForm({ ...form, dailyGoalMinutes: Math.max(15, Math.min(720, Number(event.target.value) || 15)) })} /></label>
          <label className="text-sm"><span className="label">Language</span><select className="input" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value as Language })}><option value="en">English</option><option value="hi">Hindi</option></select></label>
        </div>
        <fieldset>
          <legend className="label">Subjects</legend>
          <div className="flex flex-wrap gap-2">
            {allowed.map((subject) => (
              <label key={subject} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${form.subjects.includes(subject) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
                <input type="checkbox" className="sr-only" checked={form.subjects.includes(subject)} onChange={() => setForm({ ...form, subjects: form.subjects.includes(subject) ? form.subjects.filter((item) => item !== subject) : [...form.subjects, subject] })} />
                {SUBJECT_NAMES[subject]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Notifications</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(PREF_LABELS) as (keyof NotificationPrefs)[]).map((key) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"><span>{PREF_LABELS[key]}</span><input type="checkbox" checked={form.notificationPrefs[key] ?? true} onChange={(event) => setForm({ ...form, notificationPrefs: { ...form.notificationPrefs, [key]: event.target.checked } })} /></label>
            ))}
          </div>
        </fieldset>
        <InlineError message={save.error} />
        {saved && <p className="text-sm font-semibold text-success-500" role="status">Saved.</p>}
        <button type="submit" className="btn-primary" disabled={save.busy}>{save.busy ? "Saving..." : "Save changes"}</button>
      </form>

      <section className="card mt-4">
        <h2 className="text-lg font-semibold">Display</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"><span>Low data mode</span><input type="checkbox" checked={preferences.lowData} onChange={(event) => preferences.update({ lowData: event.target.checked })} /></label>
          <label className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"><span>Reduce motion</span><input type="checkbox" checked={preferences.reduceMotion} onChange={(event) => preferences.update({ reduceMotion: event.target.checked })} /></label>
          <label className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"><span>Text size</span>
            <select className="input w-28" value={preferences.fontScale} onChange={(event) => preferences.update({ fontScale: Number(event.target.value) as 1 | 1.125 | 1.25 })}><option value={1}>Normal</option><option value={1.125}>Large</option><option value={1.25}>Larger</option></select>
          </label>
        </div>
      </section>

      <section className="card mt-4">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <p className="mt-1 text-sm text-ink-700">Other students see only your anonymous username, avatar, class, goal, subjects and level. Your name, email, phone and school are private. Blocked students cannot find you in Buddy matching.</p>
      </section>

      {isPasswordAccount && (
        <form className="card mt-4" onSubmit={(event) => { event.preventDefault(); setPasswordDone(false); void changePassword.run(); }}>
          <h2 className="text-lg font-semibold">Password</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm"><span className="label">Current password</span><input className="input" type="password" autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} /></label>
            <label className="text-sm"><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" minLength={6} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} /></label>
          </div>
          <InlineError message={changePassword.error} />
          {passwordDone && <p className="mt-2 text-sm font-semibold text-success-500" role="status">Password updated.</p>}
          <button type="submit" className="btn-secondary mt-3" disabled={changePassword.busy || !passwords.current || !passwords.next}>Change password</button>
        </form>
      )}

      <section className="card mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Log out</h2>
          <p className="text-sm text-ink-500">Your progress stays saved to your account.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => logout().then(() => navigate("/login"))}>Log out</button>
      </section>

      <section className="card mt-4 border-danger-500/30">
        <h2 className="text-lg font-semibold text-danger-500">Delete account</h2>
        <p className="mt-1 text-sm text-ink-700">Removes your learning data, conversations, projects and sign-in. This cannot be undone.</p>
        <button type="button" className="btn-danger mt-3" onClick={() => setDeleteOpen(true)}>Delete my account</button>
      </section>
      <Modal open={deleteOpen} title="Delete account" onClose={() => setDeleteOpen(false)}>
        <p className="text-sm">Type <span className="font-mono font-semibold">DELETE</span> to confirm. Deletion runs on the server and cannot be undone.</p>
        <input className="input mt-3" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} aria-label="Type DELETE to confirm" />
        <InlineError message={remove.error ? errorMessage(remove.error) : null} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleteOpen(false)}>Cancel</button>
          <button type="button" className="btn-danger" disabled={confirmText !== "DELETE" || remove.busy} onClick={() => void remove.run()}>{remove.busy ? "Deleting..." : "Delete permanently"}</button>
        </div>
      </Modal>
    </div>
  );
}
