import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { istToday } from "../lib/format";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, PageHeader } from "../components/ui";
import type { DailyActivityDoc } from "../lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Learning calendar: one month of dailyActivity docs, click a day for the full breakdown. */
export default function CalendarPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const today = istToday();
  const [month, setMonth] = useState(() => new Date(`${today.slice(0, 7)}-01T00:00:00Z`));
  const [selected, setSelected] = useState<string>(today);
  const key = monthKey(month);
  const days = useQueryOnce<DailyActivityDoc>(() => (uid ? query(collection(db, "dailyActivity"), where("uid", "==", uid), where("date", ">=", `${key}-01`), where("date", "<=", `${key}-31`), orderBy("date", "asc")) : null), [uid, key]);
  const topics = useContent(() => content.allTopics(), []);
  const byDate = useMemo(() => new Map(days.data.map((day) => [day.date, day])), [days.data]);

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const list: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) list.push(`${key}-${String(day).padStart(2, "0")}`);
    return list;
  }, [month, key]);

  const totals = days.data.reduce((sum, day) => ({ minutes: sum.minutes + day.minutes, questions: sum.questions + day.questions, active: sum.active + (day.qualified ? 1 : 0) }), { minutes: 0, questions: 0, active: 0 });
  const selectedDay = byDate.get(selected);
  const shift = (delta: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Learning Calendar" subtitle="Only days with saved learning appear. Green days counted toward your streak." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card">
          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <h2 className="text-lg font-semibold">{month.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
            <button type="button" className="btn-secondary" onClick={() => shift(1)} aria-label="Next month" disabled={key >= today.slice(0, 7)}>›</button>
          </div>
          <p className="mt-1 text-sm text-ink-500">{totals.active} active days · {totals.minutes} minutes · {totals.questions} questions this month</p>
          <AsyncState loading={days.loading} error={days.error} onRetry={days.reload} skeletonLines={6}>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-ink-500">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((date, index) => {
                if (!date) return <div key={`blank-${index}`} />;
                const day = byDate.get(date);
                const future = date > today;
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={future}
                    aria-pressed={selected === date}
                    aria-label={`${date}${day ? `, ${day.minutes} minutes, ${day.questions} questions` : ", no activity"}`}
                    onClick={() => setSelected(date)}
                    className={`aspect-square rounded-lg p-1 text-xs ${selected === date ? "ring-2 ring-brand-500" : ""} ${future ? "opacity-30" : ""} ${day?.qualified ? "bg-success-500/20 text-success-500" : day ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"}`}
                  >
                    <span className="block font-semibold">{Number(date.slice(8))}</span>
                    {day && <span className="block">{day.minutes}m</span>}
                  </button>
                );
              })}
            </div>
          </AsyncState>
        </section>
        <aside className="card">
          <h2 className="text-lg font-semibold">{selected === today ? "Today" : selected}</h2>
          {selectedDay ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Study time" value={`${selectedDay.minutes} min`} />
              <Row label="Questions" value={`${selectedDay.questions} (${selectedDay.correct} correct)`} />
              <Row label="Accuracy" value={selectedDay.questions ? `${Math.round((selectedDay.correct / selectedDay.questions) * 100)}%` : "No questions"} />
              <Row label="Lessons" value={String(selectedDay.lessons)} />
              <Row label="Assessments" value={String(selectedDay.assessments)} />
              <Row label="XP earned" value={`+${selectedDay.xp}`} />
              <Row label="Orbit Coins earned" value={`+${selectedDay.coins}`} />
              <Row label="Streak day" value={selectedDay.qualified ? "Yes" : "Not enough activity"} />
              <div>
                <dt className="text-ink-500">Topics</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {selectedDay.topicIds.length === 0 && <span className="text-ink-500">None recorded</span>}
                  {selectedDay.topicIds.map((topicId) => <span key={topicId} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs">{topics.data?.find((topic) => topic.id === topicId)?.name ?? topicId}</span>)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-500">{selected > today ? "This day has not happened yet." : "No learning recorded on this day."}</p>
          )}
          {profile && <p className="mt-4 text-xs text-ink-500">Daily goal: {profile.dailyGoalMinutes} minutes. <Link to="/settings" className="text-brand-600 underline">Change</Link></p>}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-ink-500">{label}</dt><dd className="font-semibold">{value}</dd></div>;
}
