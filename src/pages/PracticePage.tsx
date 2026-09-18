import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent, type QuestionFilter } from "../lib/content";
import { db } from "../lib/firebase";
import { CLASS_LEVELS, isSubjectId, parseClassLevel, SUBJECT_IDS, SUBJECT_NAMES } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, EmptyState, PageHeader, RewardToast, Tabs } from "../components/ui";
import { QuestionCard } from "../components/QuestionCard";
import type { OutcomeResult } from "../lib/callables";
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, type Difficulty, type QuestionDoc, type QuestionType, type SubjectId, type TopicMasteryDoc } from "../lib/types";

type Mode = "random" | "weak" | "chapter" | "mixed" | "timed";
const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "random", label: "Random", blurb: "Shuffled questions from your filters." },
  { id: "weak", label: "Weak Topic", blurb: "Only topics rated Weak or Needs Practice." },
  { id: "chapter", label: "Chapter", blurb: "Work through one chapter in order." },
  { id: "mixed", label: "Mixed", blurb: "One of each difficulty in rotation." },
  { id: "timed", label: "Timed", blurb: "Ten questions, ninety seconds each." }
];
const TIMED_SECONDS = 90;

function shuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed || 1;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const swap = Math.floor((state / 233280) * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Practice: filters (class, subject, chapter, topic, difficulty, type) and five modes over the question bank. */
export default function PracticePage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const [params, setParams] = useSearchParams();
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const mode = (MODES.some((item) => item.id === params.get("mode")) ? params.get("mode") : "random") as Mode;
  const classLevel = parseClassLevel(params.get("classLevel") ?? undefined) ?? profile?.classLevel ?? 10;
  const subjectId = isSubjectId(params.get("subjectId")) ? (params.get("subjectId") as SubjectId) : null;
  const chapterId = params.get("chapterId");
  const topicId = params.get("topicId");
  const difficulty = ([1, 2, 3].includes(Number(params.get("difficulty"))) ? Number(params.get("difficulty")) : null) as Difficulty | null;
  const type = (Object.keys(QUESTION_TYPE_LABELS).includes(params.get("type") ?? "") ? params.get("type") : null) as QuestionType | null;
  const pyqOnly = params.get("pyq") === "1";

  const set = (patch: Record<string, string | null>) =>
    setParams((previous) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") previous.delete(key);
        else previous.set(key, value);
      }
      return previous;
    }, { replace: true });

  const chapters = useContent(() => (subjectId ? content.chapters(classLevel, subjectId) : Promise.resolve([])), [classLevel, subjectId]);
  const topics = useContent(() => (chapterId ? content.topics(chapterId) : Promise.resolve([])), [chapterId]);
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid && mode === "weak" ? query(collection(db, "topicMastery"), where("userId", "==", uid), where("strength", "in", ["weak", "needs_practice"])) : null), [uid, mode]);
  const filter: QuestionFilter = useMemo(() => ({ classLevel: topicId || chapterId ? null : classLevel, subjectId: topicId || chapterId ? null : subjectId, chapterId: topicId ? null : chapterId, topicId, difficulty, type, max: 80 }), [classLevel, subjectId, chapterId, topicId, difficulty, type]);
  const weakFilters = useMemo(() => mastery.data.slice(0, 5).map((row) => ({ topicId: row.topicId, max: 20 })), [mastery.data]);
  const questions = useContent(async () => {
    if (mode === "weak") {
      if (mastery.loading) return null;
      const sets = await Promise.all(weakFilters.map((weakFilter) => content.questions(weakFilter)));
      return sets.flat();
    }
    if (mode === "chapter" && !chapterId) return [];
    return content.questions(filter);
  }, [mode, JSON.stringify(filter), JSON.stringify(weakFilters), mastery.loading]);

  const [seed, setSeed] = useState(() => Date.now() % 100_000);
  const pool = useMemo(() => {
    let rows: QuestionDoc[] = (questions.data ?? []).filter((question) => !pyqOnly || question.pyq);
    if (mode === "chapter") rows = [...rows].sort((left, right) => left.topicId.localeCompare(right.topicId) || left.difficulty - right.difficulty);
    else if (mode === "mixed") {
      const byLevel: Record<Difficulty, QuestionDoc[]> = { 1: [], 2: [], 3: [] };
      for (const row of shuffle(rows, seed)) byLevel[row.difficulty].push(row);
      rows = [];
      while (byLevel[1].length || byLevel[2].length || byLevel[3].length) for (const level of [1, 2, 3] as Difficulty[]) { const next = byLevel[level].shift(); if (next) rows.push(next); }
    } else rows = shuffle(rows, seed);
    return mode === "timed" ? rows.slice(0, 10) : rows;
  }, [questions.data, mode, seed, pyqOnly]);

  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  useEffect(() => { setIndex(0); setAnswered(0); setCorrect(0); }, [mode, JSON.stringify(filter), seed, pyqOnly]);
  const current = pool[index];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Practice" subtitle="Every answer is graded on the server and updates your topic mastery. First correct attempts earn XP and Orbit Coins." />
      <Tabs tabs={MODES.map((item) => ({ id: item.id, label: item.label }))} value={mode} onChange={(next) => set({ mode: next })} />
      <p className="-mt-2 mb-4 text-sm text-ink-500">{MODES.find((item) => item.id === mode)?.blurb}</p>

      {mode !== "weak" && (
        <div className="card mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="text-sm"><span className="label">Class</span>
            <select className="input" value={classLevel} onChange={(event) => set({ classLevel: event.target.value, chapterId: null, topicId: null })}>{CLASS_LEVELS.map((level) => <option key={level} value={level}>Class {level}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Subject</span>
            <select className="input" value={subjectId ?? ""} onChange={(event) => set({ subjectId: event.target.value || null, chapterId: null, topicId: null })}><option value="">All four</option>{SUBJECT_IDS.map((subject) => <option key={subject} value={subject}>{SUBJECT_NAMES[subject]}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Chapter</span>
            <select className="input" value={chapterId ?? ""} disabled={!subjectId} onChange={(event) => set({ chapterId: event.target.value || null, topicId: null })}><option value="">{subjectId ? "All chapters" : "Pick a subject"}</option>{(chapters.data ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}{chapter.hasContent ? "" : " (preparing)"}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Topic</span>
            <select className="input" value={topicId ?? ""} disabled={!chapterId} onChange={(event) => set({ topicId: event.target.value || null })}><option value="">{chapterId ? "All topics" : "Pick a chapter"}</option>{(topics.data ?? []).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Difficulty</span>
            <select className="input" value={difficulty ?? ""} onChange={(event) => set({ difficulty: event.target.value || null })}><option value="">Any</option>{([1, 2, 3] as Difficulty[]).map((level) => <option key={level} value={level}>{DIFFICULTY_LABELS[level]}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Type</span>
            <select className="input" value={type ?? ""} onChange={(event) => set({ type: event.target.value || null })}><option value="">Any</option>{(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((item) => <option key={item} value={item}>{QUESTION_TYPE_LABELS[item]}</option>)}</select>
          </label>
        </div>
      )}
      {pyqOnly && <p className="mb-3 text-sm text-ink-500">Showing previous year questions only. <button type="button" className="text-brand-600 underline" onClick={() => set({ pyq: null })}>Show all</button></p>}

      <AsyncState loading={questions.loading || (mode === "weak" && mastery.loading)} error={questions.error ?? mastery.error} empty={pool.length === 0}
        emptyTitle={mode === "weak" ? "No weak topics yet" : mode === "chapter" && !chapterId ? "Choose a subject and chapter" : "Content for this selection is being prepared."}
        emptyBody={mode === "weak" ? "Complete a few assessments and EduOrbit will identify where you need more practice." : mode === "chapter" && !chapterId ? "Chapter practice works through one chapter in order." : "Try a wider filter, or another chapter that is marked Ready in Learn."}>
        {current ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-500">
              <span>{answered} answered · {correct} correct{mode === "timed" ? ` · ${TIMED_SECONDS}s per question` : ""}</span>
              <button type="button" className="btn-ghost py-1" onClick={() => setSeed(Date.now() % 100_000)}>Reshuffle</button>
            </div>
            {mode === "timed" && <Countdown key={current.id} seconds={TIMED_SECONDS} onExpire={() => setIndex((value) => Math.min(value + 1, pool.length - 1))} />}
            <QuestionCard
              key={current.id}
              question={current}
              index={index}
              total={pool.length}
              context="practice"
              askAiPath="/orbitai"
              onAnswered={(event) => { setAnswered((value) => value + 1); if (event.response.correct) setCorrect((value) => value + 1); if (event.response.rewards) setToast(event.response.rewards); }}
              onNext={index + 1 < pool.length ? () => setIndex(index + 1) : undefined}
              onTrySimilar={pool.length > 1 ? () => setIndex((index + 1) % pool.length) : undefined}
            />
            {index + 1 >= pool.length && <EmptyState title="End of this set" body={`You answered ${answered} with ${correct} correct.`} action={<button type="button" className="btn-primary" onClick={() => setSeed(Date.now() % 100_000)}>New set</button>} />}
          </div>
        ) : null}
      </AsyncState>
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Countdown({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, onExpire]);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200" role="timer" aria-label={`${left} seconds left`}>
      <div className={`h-full transition-all ${left < 15 ? "bg-danger-500" : "bg-brand-500"}`} style={{ width: `${(left / seconds) * 100}%` }} />
    </div>
  );
}
