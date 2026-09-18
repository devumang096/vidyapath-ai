import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { istToday } from "../lib/format";
import { byStrength, continueLearning, recommendNext } from "../lib/recommend";
import { SUBJECT_NAMES } from "../lib/subjects";
import { useDoc, useQueryOnce } from "../hooks/useFirestore";
import { effectiveStreak } from "../../functions/src/lib/streak.js";
import { AsyncState, EmptyState, PageHeader, ProgressBar, RewardToast, StatTile, StrengthTag } from "../components/ui";
import { StudyTimer } from "../components/StudyTimer";
import type { OutcomeResult } from "../lib/callables";
import type { ChapterProgressDoc, DailyActivityDoc, LessonProgressDoc, TopicMasteryDoc } from "../lib/types";

export default function DashboardPage() {
  const { user, profile, streak } = useAuth();
  const uid = user?.uid ?? "";
  const today = istToday();
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const activity = useDoc<DailyActivityDoc>(uid ? `dailyActivity/${uid}_${today}` : null);
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid ? query(collection(db, "topicMastery"), where("userId", "==", uid)) : null), [uid]);
  const lessonProgress = useQueryOnce<LessonProgressDoc>(() => (uid ? query(collection(db, "lessonProgress"), where("userId", "==", uid)) : null), [uid]);
  const chapterProgress = useQueryOnce<ChapterProgressDoc>(() => (uid ? query(collection(db, "chapterProgress"), where("userId", "==", uid)) : null), [uid]);
  const recentDays = useQueryOnce<DailyActivityDoc>(() => (uid ? query(collection(db, "dailyActivity"), where("uid", "==", uid), orderBy("date", "desc"), limit(14)) : null), [uid]);
  const topics = useContent(() => content.allTopics(), []);
  const chapters = useContent(() => content.allChapters(), []);

  const loading = mastery.loading || lessonProgress.loading || chapterProgress.loading || topics.loading || chapters.loading;
  const error = mastery.error ?? lessonProgress.error ?? chapterProgress.error ?? topics.error ?? chapters.error;
  const groups = useMemo(() => byStrength(mastery.data), [mastery.data]);
  const recommendation = useMemo(() => recommendNext(mastery.data, topics.data ?? [], chapters.data ?? [], lessonProgress.data), [mastery.data, topics.data, chapters.data, lessonProgress.data]);
  const resume = useMemo(() => continueLearning(mastery.data, lessonProgress.data, topics.data ?? [], chapters.data ?? [], chapterProgress.data), [mastery.data, lessonProgress.data, topics.data, chapters.data, chapterProgress.data]);
  const topicName = (topicId: string) => topics.data?.find((topic) => topic.id === topicId)?.name ?? topicId;
  const topicLink = (topicId: string) => {
    const topic = topics.data?.find((item) => item.id === topicId);
    const chapter = topic ? chapters.data?.find((item) => item.id === topic.chapterId) : null;
    return topic && chapter ? learnPath(chapter, topic) : "/learn";
  };

  if (!profile) return null;
  const totalAttempts = mastery.data.reduce((sum, row) => sum + row.attempts, 0);
  const totalCorrect = mastery.data.reduce((sum, row) => sum + row.correct, 0);
  const accuracy = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : null;
  const minutesToday = activity.data?.minutes ?? 0;
  const hasAnyActivity = totalAttempts > 0 || profile.lessonsCompleted > 0 || profile.totalStudyMinutes > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Welcome back, ${profile.name.split(" ")[0]}`} subtitle={`Class ${profile.classLevel} · ${profile.subjects.map((subject) => SUBJECT_NAMES[subject]).join(", ")}`} action={<Link to="/orbitai" className="btn-primary">Ask OrbitAI</Link>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Current streak" value={`🔥 ${streak ? effectiveStreak(streak, today) : 0}`} hint={streak?.protectionTokens ? `${streak.protectionTokens} protection token` : "days in a row"} to="/rewards" />
        <StatTile label="Longest streak" value={`${streak?.longest ?? 0} days`} to="/calendar" />
        <StatTile label="Orbit Coins" value={`🪙 ${profile.coins}`} to="/rewards" />
        <StatTile label="XP" value={`⚡ ${profile.xp}`} to="/progress" />
        <StatTile label="Study time" value={`${Math.floor(profile.totalStudyMinutes / 60)}h ${profile.totalStudyMinutes % 60}m`} hint="all time" to="/calendar" />
        <StatTile label="Questions solved" value={profile.questionsSolved} hint="first correct attempts" to="/practice" />
        <StatTile label="Accuracy" value={accuracy === null ? "No data" : `${accuracy}%`} hint={totalAttempts ? `${totalAttempts} attempts` : "answer a question to start"} to="/progress" />
        <StatTile label="Chapters completed" value={profile.chaptersCompleted} to="/learn" />
      </div>

      {!hasAnyActivity && (
        <div className="mt-6">
          <EmptyState
            title="Start your first lesson to begin building your learning journey."
            body="Every tile above fills from real activity: lessons, questions, assessments and study time. Nothing here is estimated."
            action={<Link to="/learn" className="btn-primary">Open Learn</Link>}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="continue-heading">
          <h2 id="continue-heading" className="text-lg font-semibold">Continue learning</h2>
          <AsyncState loading={loading} error={error} empty={!resume} emptyTitle="Nothing in progress" emptyBody="Pick a chapter in Learn to get going.">
            {resume && (
              <div className="mt-3">
                <p className="text-sm text-ink-500">{SUBJECT_NAMES[resume.chapter.subjectId]} · Class {resume.chapter.classLevel} · {resume.chapter.name}</p>
                <p className="text-xl font-semibold">{resume.topic.name}</p>
                <div className="mt-3"><ProgressBar value={resume.progress} label="Topic progress" /></div>
                <Link to={learnPath(resume.chapter, resume.topic)} className="btn-primary mt-4">Continue</Link>
              </div>
            )}
          </AsyncState>
        </section>
        <section className="card" aria-labelledby="goal-heading">
          <h2 id="goal-heading" className="text-lg font-semibold">Daily goal</h2>
          <p className="mt-1 text-3xl font-bold">{minutesToday} <span className="text-base font-medium text-ink-500">/ {profile.dailyGoalMinutes} minutes</span></p>
          <div className="mt-2"><ProgressBar value={(minutesToday / profile.dailyGoalMinutes) * 100} tone={minutesToday >= profile.dailyGoalMinutes ? "success" : "brand"} /></div>
          <p className="mt-2 text-xs text-ink-500">Counted from saved study sessions today.</p>
          <div className="mt-3"><StudyTimer compact onRecorded={(rewards) => { setToast(rewards); activity.reload(); }} /></div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card" aria-labelledby="today-heading">
          <h2 id="today-heading" className="text-lg font-semibold">Today's activity</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-500">Lessons</dt><dd className="text-xl font-semibold">{activity.data?.lessons ?? 0}</dd></div>
            <div><dt className="text-ink-500">Questions</dt><dd className="text-xl font-semibold">{activity.data?.questions ?? 0}</dd></div>
            <div><dt className="text-ink-500">Assessments</dt><dd className="text-xl font-semibold">{activity.data?.assessments ?? 0}</dd></div>
            <div><dt className="text-ink-500">Study time</dt><dd className="text-xl font-semibold">{minutesToday} min</dd></div>
          </dl>
          {activity.data?.qualified ? <p className="mt-3 text-xs font-semibold text-success-500">Today counts toward your streak.</p> : <p className="mt-3 text-xs text-ink-500">20 minutes, 10 questions, a lesson or an assessment keeps your streak today.</p>}
        </section>
        <section className="card" aria-labelledby="strengths-heading">
          <h2 id="strengths-heading" className="text-lg font-semibold">Strengths</h2>
          <TopicList rows={[...groups.strong, ...groups.good].slice(0, 4)} emptyText="Complete a few practice sets and your strong topics will show here." topicName={topicName} topicLink={topicLink} />
        </section>
        <section className="card" aria-labelledby="weak-heading">
          <h2 id="weak-heading" className="text-lg font-semibold">Needs practice</h2>
          <TopicList rows={[...groups.weak, ...groups.needs_practice].slice(0, 4)} emptyText="Complete a few assessments and EduOrbit will identify where you need more practice." topicName={topicName} topicLink={topicLink} />
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="next-heading">
          <h2 id="next-heading" className="text-lg font-semibold">Recommended next</h2>
          {recommendation ? (
            <div className="mt-2">
              <p className="text-xl font-semibold">{recommendation.title}</p>
              <p className="mt-1 text-sm text-ink-700">{recommendation.reason}</p>
              <Link to={recommendation.link} className="btn-primary mt-3">Go</Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-500">Recommendations appear once you have answered a few questions.</p>
          )}
        </section>
        <section className="card" aria-labelledby="social-heading">
          <h2 id="social-heading" className="text-lg font-semibold">Buddy and groups</h2>
          <p className="mt-2 text-sm text-ink-700">Buddy: <Link to="/buddy" className="text-brand-600 hover:underline">find a study partner</Link>.</p>
          <p className="mt-1 text-sm text-ink-700">Groups: <Link to="/groups" className="text-brand-600 hover:underline">join or create a study group</Link>.</p>
        </section>
      </div>

      <section className="card mt-4" aria-labelledby="calendar-heading">
        <div className="flex items-center justify-between">
          <h2 id="calendar-heading" className="text-lg font-semibold">Last two weeks</h2>
          <Link to="/calendar" className="text-sm text-brand-600 hover:underline">Open calendar</Link>
        </div>
        <ActivityStrip days={recentDays.data} today={today} />
      </section>
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function TopicList({ rows, emptyText, topicName, topicLink }: { rows: TopicMasteryDoc[]; emptyText: string; topicName: (id: string) => string; topicLink: (id: string) => string }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-ink-500">{emptyText}</p>;
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-2">
          <Link to={topicLink(row.topicId)} className="text-brand-700 hover:underline">{topicName(row.topicId)}</Link>
          <span className="flex items-center gap-2 text-xs text-ink-500">{Math.round(row.mastery)} <StrengthTag strength={row.strength} /></span>
        </li>
      ))}
    </ul>
  );
}

function ActivityStrip({ days, today }: { days: DailyActivityDoc[]; today: string }) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const cells = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) - (13 - index) * 86_400_000).toISOString().slice(0, 10);
    return { date, day: byDate.get(date) };
  });
  return (
    <ol className="mt-3 grid grid-cols-7 gap-1 sm:grid-cols-14">
      {cells.map((cell) => (
        <li key={cell.date} className={`rounded-lg p-2 text-center text-xs ${cell.day?.qualified ? "bg-success-500/20 text-success-500" : cell.day ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"}`} title={cell.day ? `${cell.day.minutes} min, ${cell.day.questions} questions` : "No activity"}>
          <span className="block font-semibold">{cell.date.slice(8)}</span>
          <span className="block">{cell.day ? `${cell.day.minutes}m` : "-"}</span>
        </li>
      ))}
    </ol>
  );
}
