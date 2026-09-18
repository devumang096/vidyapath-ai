import { useMemo } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../context/AuthContext";
import { content, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { byStrength, STRENGTH_ORDER } from "../lib/recommend";
import { SUBJECT_IDS, SUBJECT_NAMES } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, PageHeader, StrengthTag } from "../components/ui";
import { STRENGTH_LABELS, type BadgeDoc, type DailyActivityDoc, type TopicMasteryDoc } from "../lib/types";

export default function ProgressPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid ? query(collection(db, "topicMastery"), where("userId", "==", uid)) : null), [uid]);
  const days = useQueryOnce<DailyActivityDoc>(() => (uid ? query(collection(db, "dailyActivity"), where("uid", "==", uid), orderBy("date", "desc"), limit(30)) : null), [uid]);
  const earned = useQueryOnce<{ badgeId: string; awardedAt: unknown }>(() => (uid ? query(collection(db, `userBadges/${uid}/badges`)) : null), [uid]);
  const topics = useContent(() => content.allTopics(), []);
  const chapters = useContent(() => content.allChapters(), []);
  const badges = useContent(() => content.badges(), []);

  const bySubject = useMemo(() => SUBJECT_IDS.map((subject) => {
    const rows = mastery.data.filter((row) => row.subjectId === subject);
    const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
    const correct = rows.reduce((sum, row) => sum + row.correct, 0);
    return { subject: SUBJECT_NAMES[subject], accuracy: attempts ? Math.round((correct / attempts) * 100) : 0, attempts, mastery: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.mastery, 0) / rows.length) : 0 };
  }).filter((row) => row.attempts > 0), [mastery.data]);
  const groups = useMemo(() => byStrength(mastery.data), [mastery.data]);
  const series = useMemo(() => [...days.data].reverse().map((day) => ({ date: day.date.slice(5), minutes: day.minutes, questions: day.questions, accuracy: day.questions ? Math.round((day.correct / day.questions) * 100) : null })), [days.data]);
  const topicMeta = (topicId: string) => {
    const topic = topics.data?.find((item) => item.id === topicId);
    const chapter = topic ? chapters.data?.find((item) => item.id === topic.chapterId) : null;
    return { name: topic?.name ?? topicId, chapter: chapter?.name ?? "", link: topic && chapter ? learnPath(chapter, topic) : "/learn" };
  };
  const loading = mastery.loading || topics.loading || chapters.loading;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Progress" subtitle="Everything here is derived from graded answers, assessments and saved study sessions." />
      <AsyncState loading={loading} error={mastery.error ?? topics.error ?? chapters.error} empty={mastery.data.length === 0} emptyTitle="Start your first lesson to begin building your learning journey." emptyBody="Answer questions in any topic and this page fills with real accuracy, mastery and strength data." emptyAction={<Link to="/learn" className="btn-primary">Open Learn</Link>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <h2 className="text-lg font-semibold">Accuracy by subject</h2>
            <div className="mt-3 h-56">
              <ResponsiveContainer>
                <BarChart data={bySubject}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="subject" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="accuracy" name="Accuracy %" fill="#2f5bea" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="mastery" name="Avg mastery" fill="#93b0ff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card">
            <h2 className="text-lg font-semibold">Study minutes, last 30 days</h2>
            <div className="mt-3 h-56">
              {series.length ? (
                <ResponsiveContainer>
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="minutes" name="Minutes" stroke="#2f5bea" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="questions" name="Questions" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-ink-500">Save a study session to see your minutes here.</p>}
            </div>
          </section>
        </div>

        <section className="card mt-4">
          <h2 className="text-lg font-semibold">Strengths and weaknesses</h2>
          <p className="text-sm text-ink-500">Topics need three graded attempts before they are rated.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STRENGTH_ORDER.filter((strength) => strength !== "unrated").map((strength) => (
              <div key={strength}>
                <h3 className="flex items-center gap-2 text-sm font-semibold"><StrengthTag strength={strength} /><span className="text-ink-500">{groups[strength].length}</span></h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {groups[strength].length === 0 && <li className="text-ink-500">None yet</li>}
                  {groups[strength].map((row) => {
                    const meta = topicMeta(row.topicId);
                    return <li key={row.id}><Link to={meta.link} className="text-brand-700 hover:underline">{meta.name}</Link> <span className="text-xs text-ink-500">{meta.chapter} · {Math.round(row.mastery)}</span></li>;
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="card mt-4 overflow-x-auto">
          <h2 className="text-lg font-semibold">Topic table</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-500"><tr><th className="py-2">Topic</th><th>Subject</th><th>Attempts</th><th>Accuracy</th><th>Mastery</th><th>Strength</th></tr></thead>
            <tbody>
              {[...mastery.data].sort((left, right) => left.mastery - right.mastery).map((row) => {
                const meta = topicMeta(row.topicId);
                return (
                  <tr key={row.id} className="border-t border-ink-200">
                    <td className="py-2"><Link to={meta.link} className="text-brand-700 hover:underline">{meta.name}</Link></td>
                    <td>{SUBJECT_NAMES[row.subjectId]}</td>
                    <td>{row.attempts}</td>
                    <td>{row.accuracy}%</td>
                    <td>{Math.round(row.mastery)}</td>
                    <td><StrengthTag strength={row.strength} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </AsyncState>

      <section className="card mt-4">
        <h2 className="text-lg font-semibold">Badges</h2>
        <AsyncState loading={badges.loading || earned.loading} error={badges.error ?? earned.error} skeletonLines={2}>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(badges.data ?? []).map((badge: BadgeDoc) => {
              const has = earned.data.some((item) => item.badgeId === badge.id) || ((profile as unknown as { badgeIds?: string[] })?.badgeIds ?? []).includes(badge.id);
              return (
                <li key={badge.id} className={`rounded-xl border p-3 text-sm ${has ? "border-success-500 bg-success-500/10" : "border-ink-200 opacity-70"}`}>
                  <p className="font-semibold">{badge.icon} {badge.name}</p>
                  <p className="text-xs text-ink-500">{badge.description}</p>
                  <p className="mt-1 text-xs">{has ? "Earned" : `Unlocks when: ${badge.criteria}`}</p>
                </li>
              );
            })}
          </ul>
        </AsyncState>
        <p className="mt-3 text-xs text-ink-500">Strength labels: {STRENGTH_ORDER.filter((strength) => strength !== "unrated").map((strength) => STRENGTH_LABELS[strength]).join(", ")}.</p>
      </section>
    </div>
  );
}
