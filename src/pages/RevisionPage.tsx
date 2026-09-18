import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, query } from "firebase/firestore";
import { db } from "../lib/firebase";
import { api, type OutcomeResult } from "../lib/callables";
import { content, SUBJECT_NAMES, useContent } from "../lib/content";
import { newId, toDate } from "../lib/format";
import { summarizeProgress, weakTopics } from "../lib/planner";
import { useAuth } from "../context/AuthContext";
import { useAction, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, PageHeader, RewardToast, Tag } from "../components/ui";
import { MISTAKE_LABELS, type TopicDoc, type TopicProgressDoc } from "../lib/types";

const STALE_DAYS = 7;
const REVISE_TODAY_CAP = 5;

export default function RevisionPage() {
  const { user } = useAuth();
  const topics = useContent(() => content.allTopics(), []);
  const progress = useQueryOnce<TopicProgressDoc>(() => (user ? query(collection(db, `studentProgress/${user.uid}/topics`)) : null), [user?.uid]);
  const [toast, setToast] = useState<OutcomeResult | null>(null);

  const topicById = useMemo(() => new Map((topics.data ?? []).map((topic) => [topic.id, topic])), [topics.data]);
  const summaries = useMemo(
    () =>
      progress.data
        .filter((entry) => topicById.has(entry.topicId))
        .map((entry) => {
          const topic = topicById.get(entry.topicId)!;
          return summarizeProgress(entry, topic.name, SUBJECT_NAMES[topic.subjectId], toDate(entry.lastPracticedAt));
        }),
    [progress.data, topicById]
  );
  const weak = useMemo(() => weakTopics(summaries), [summaries]);

  const reviseToday = useMemo(() => {
    const now = Date.now();
    const chosen: string[] = [];
    const add = (topicId: string) => {
      if (!chosen.includes(topicId) && topicById.get(topicId)?.revision) chosen.push(topicId);
    };
    weak.forEach((summary) => add(summary.topicId));
    summaries
      .filter((summary) => summary.lastPracticedAt && now - summary.lastPracticedAt.getTime() > STALE_DAYS * 86_400_000)
      .sort((left, right) => (left.lastPracticedAt?.getTime() ?? 0) - (right.lastPracticedAt?.getTime() ?? 0))
      .forEach((summary) => add(summary.topicId));
    const started = new Set(progress.data.map((entry) => entry.topicId));
    (topics.data ?? []).filter((topic) => topic.hasContent && !started.has(topic.id)).forEach((topic) => add(topic.id));
    return chosen.slice(0, REVISE_TODAY_CAP).map((topicId) => topicById.get(topicId)!);
  }, [weak, summaries, progress.data, topics.data, topicById]);

  return (
    <div>
      <PageHeader title="Revision" subtitle="Short cards built from your weak spots: concept, formula, the mistake to avoid, and one quick question." />
      <AsyncState loading={topics.loading || progress.loading} error={topics.error || progress.error} loadingLabel="Finding what to revise...">
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">My Weak Topics</h2>
          {weak.length === 0 ? (
            <div className="card text-sm text-ink-500">No weak topics yet. Solve a few problems in the Problem Lab and this list fills in automatically.</div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {weak.map((summary) => (
                <li key={summary.topicId} className="card">
                  <p className="font-semibold">{summary.topicName}</p>
                  <p className="text-sm text-ink-500">{summary.subjectName} · Accuracy {Math.round(summary.accuracy)}%</p>
                  {summary.mainMistake && <p className="mt-1 text-sm">Main issue: <Tag tone="warn">{MISTAKE_LABELS[summary.mainMistake]}</Tag></p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/problem-lab?topic=${summary.topicId}&level=1`} className="btn-primary">Practise Level 1</Link>
                    <Link to={`/learn/topic/${summary.topicId}`} className="btn-secondary">Open topic</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Revise Today</h2>
          {reviseToday.length === 0 ? (
            <div className="card text-sm text-ink-500">Nothing queued for today. Start a topic from the <Link to="/ncert" className="text-brand-600">NCERT hub</Link> to build your revision list.</div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {reviseToday.map((topic) => (
                <RevisionCard key={topic.id} topic={topic} onRewarded={setToast} />
              ))}
            </ul>
          )}
        </section>
      </AsyncState>
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function RevisionCard({ topic, onRewarded }: { topic: TopicDoc; onRewarded: (result: OutcomeResult) => void }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [revised, setRevised] = useState(false);
  const record = useAction(api.recordStudySession);
  const revision = topic.revision!;

  const markRevised = async () => {
    const response = await record.run({ sessionId: newId(), topicId: topic.id, minutes: 5, kind: "revision" });
    if (!response) return;
    setRevised(true);
    if (response.rewards) onRewarded(response.rewards);
  };

  return (
    <li className="card space-y-2 text-sm">
      <p className="font-semibold">{topic.name}</p>
      <p><span className="font-medium">Concept:</span> {revision.concept}</p>
      {revision.formula && <p><span className="font-medium">Formula:</span> <code className="rounded bg-ink-100 px-1">{revision.formula}</code></p>}
      <p><span className="font-medium">Common mistake:</span> {revision.commonMistake}</p>
      <div className="rounded-lg bg-brand-50 p-3">
        <p><span className="font-medium">Quick question:</span> {revision.miniQuestion.question}</p>
        {showAnswer ? (
          <p className="mt-1 text-brand-700">Answer: {revision.miniQuestion.answer}</p>
        ) : (
          <button type="button" className="btn-ghost mt-1 px-2 py-1" onClick={() => setShowAnswer(true)}>Show answer</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-primary" disabled={revised || record.busy} onClick={markRevised}>
          {revised ? "Revised today" : record.busy ? "Saving..." : "Mark revised"}
        </button>
        <Link to={`/problem-lab?topic=${topic.id}&level=1`} className="btn-secondary">Practise Level 1</Link>
        <Link to={`/learn/topic/${topic.id}`} className="btn-ghost">Open topic</Link>
      </div>
      {record.error && <p className="text-danger-500" role="alert">{record.error}</p>}
    </li>
  );
}
