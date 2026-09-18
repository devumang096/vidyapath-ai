import { Link } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { istToday } from "../lib/format";
import { SUBJECT_NAMES } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { effectiveStreak } from "../../functions/src/lib/streak.js";
import { AsyncState, PageHeader, StatTile } from "../components/ui";
import { GOAL_LABELS, LEARNING_LEVEL_LABELS, type TopicMasteryDoc } from "../lib/types";

export default function ProfilePage() {
  const { user, profile, streak } = useAuth();
  const uid = user?.uid ?? "";
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid ? query(collection(db, "topicMastery"), where("userId", "==", uid)) : null), [uid]);
  const earned = useQueryOnce<{ badgeId: string }>(() => (uid ? query(collection(db, `userBadges/${uid}/badges`)) : null), [uid]);
  const badges = useContent(() => content.badges(), []);
  if (!profile) return null;
  const attempts = mastery.data.reduce((sum, row) => sum + row.attempts, 0);
  const correct = mastery.data.reduce((sum, row) => sum + row.correct, 0);
  const owned = new Set(earned.data.map((item) => item.badgeId));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Profile" action={<Link to="/settings" className="btn-secondary">Settings</Link>} />
      <section className="card flex flex-wrap items-center gap-4">
        {profile.photoURL ? <img src={profile.photoURL} alt="" className="h-20 w-20 rounded-full object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-3xl font-bold text-brand-700" aria-hidden="true">{profile.name.slice(0, 1)}</div>}
        <div>
          <h2 className="text-2xl font-bold">{profile.name}</h2>
          <p className="text-sm text-ink-500">Class {profile.classLevel} · {GOAL_LABELS[profile.goal]} · {LEARNING_LEVEL_LABELS[profile.learningLevel]}</p>
          <p className="text-sm text-ink-500">{profile.subjects.map((subject) => SUBJECT_NAMES[subject]).join(", ")}{profile.school ? ` · ${profile.school}` : ""}</p>
        </div>
      </section>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="XP" value={profile.xp} />
        <StatTile label="Orbit Coins" value={profile.coins} />
        <StatTile label="Current streak" value={`${streak ? effectiveStreak(streak, istToday()) : 0} days`} />
        <StatTile label="Longest streak" value={`${streak?.longest ?? 0} days`} />
        <StatTile label="Study hours" value={`${Math.floor(profile.totalStudyMinutes / 60)}h ${profile.totalStudyMinutes % 60}m`} />
        <StatTile label="Chapters completed" value={profile.chaptersCompleted} />
        <StatTile label="Questions solved" value={profile.questionsSolved} />
        <StatTile label="Accuracy" value={attempts ? `${Math.round((correct / attempts) * 100)}%` : "No data"} hint={attempts ? `${attempts} attempts` : undefined} />
      </div>
      <section className="card mt-4">
        <h2 className="text-lg font-semibold">Badges</h2>
        <AsyncState loading={badges.loading || earned.loading} error={badges.error ?? earned.error} skeletonLines={2}>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(badges.data ?? []).map((badge) => (
              <li key={badge.id} className={`rounded-full border px-3 py-1 text-sm ${owned.has(badge.id) ? "border-success-500 bg-success-500/10" : "border-ink-200 text-ink-500 opacity-70"}`} title={badge.description}>{badge.icon} {badge.name}</li>
            ))}
          </ul>
        </AsyncState>
      </section>
      <p className="mt-4 text-xs text-ink-500">Other students only ever see an anonymous username, avatar, class, goal, subjects and level.</p>
    </div>
  );
}
