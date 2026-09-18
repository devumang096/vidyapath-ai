import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { content, learnPath, useContent } from "../lib/content";
import { api, type AssessmentSubmitResult } from "../lib/callables";
import { formatDuration, toDate } from "../lib/format";
import { useAction, useDoc } from "../hooks/useFirestore";
import { AsyncState, InlineError, PageHeader, RewardToast, StrengthTag, Tag } from "../components/ui";
import type { OutcomeResult } from "../lib/callables";
import { ASSESSMENT_KIND_LABELS, DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, type AssessmentAttemptDoc, type QuestionDoc, type SubmittedAnswer } from "../lib/types";

const DRAFT_PREFIX = "eduorbit.assessment.";

function loadDraft(attemptId: string): Record<string, SubmittedAnswer> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_PREFIX + attemptId) ?? "{}") as Record<string, SubmittedAnswer>;
  } catch (error) {
    console.warn("Could not read assessment draft", error);
    return {};
  }
}

/**
 * Runs one assessment attempt: countdown from the server-side start time, answers kept in
 * localStorage until the submission succeeds, then the graded result with strong and weak topics.
 */
export default function AssessmentRunPage() {
  const { attemptId = "" } = useParams();
  const { user } = useAuth();
  const attempt = useDoc<AssessmentAttemptDoc>(user && attemptId ? `assessmentAttempts/${attemptId}` : null);
  return (
    <div className="mx-auto max-w-4xl">
      <AsyncState loading={attempt.loading} error={attempt.error} onRetry={attempt.reload} empty={!attempt.loading && !attempt.data} emptyTitle="Assessment not found" emptyBody="It may belong to another account." emptyAction={<Link to="/assessments" className="btn-secondary">Back to assessments</Link>}>
        {attempt.data && (attempt.data.finalized ? <ResultView attempt={attempt.data} /> : <Runner attempt={attempt.data} onFinished={attempt.reload} />)}
      </AsyncState>
    </div>
  );
}

function Runner({ attempt, onFinished }: { attempt: AssessmentAttemptDoc; onFinished: () => void }) {
  const questions = useContent(() => content.questionsById(attempt.questionIds), [attempt.id]);
  const [answers, setAnswers] = useState<Record<string, SubmittedAnswer>>(() => loadDraft(attempt.id));
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<AssessmentSubmitResult | null>(null);
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const startedAt = useMemo(() => toDate(attempt.createdAt)?.getTime() ?? Date.now(), [attempt.createdAt]);
  const deadline = startedAt + attempt.timeLimitSec * 1000;
  const secondsLeft = Math.max(0, Math.floor((deadline - now) / 1000));

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_PREFIX + attempt.id, JSON.stringify(answers));
    } catch (error) {
      console.warn("Could not save assessment draft", error);
    }
  }, [answers, attempt.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const submit = useAction(async () => {
    const response = await api.submitAssessment({ attemptId: attempt.id, answers, timeTakenSec: Math.round((Date.now() - startedAt) / 1000) });
    try {
      localStorage.removeItem(DRAFT_PREFIX + attempt.id);
    } catch (error) {
      console.warn("Could not clear assessment draft", error);
    }
    setResult(response);
    if (response.rewards) setToast(response.rewards);
    onFinished();
    return response;
  });
  const submitRun = submit.run;
  const autoSubmit = useCallback(() => {
    if (!submit.busy && !result) void submitRun();
  }, [submit.busy, result, submitRun]);
  useEffect(() => {
    if (secondsLeft === 0 && questions.data) autoSubmit();
  }, [secondsLeft, questions.data, autoSubmit]);

  if (result) return <ResultView attempt={attempt} result={result} toast={toast} onToastDone={() => setToast(null)} />;
  const list = questions.data ?? [];
  const current: QuestionDoc | undefined = list[index];
  const answered = Object.keys(answers).length;

  return (
    <div>
      <PageHeader title={ASSESSMENT_KIND_LABELS[attempt.kind]} subtitle={`${attempt.questionIds.length} questions · answers are saved on this device until you submit`} crumbs={[{ label: "Assessments", to: "/assessments" }]} action={<span className={`rounded-full px-3 py-1 font-mono text-sm font-semibold ${secondsLeft < 60 ? "bg-danger-500/15 text-danger-500" : "bg-ink-100"}`} role="timer" aria-live="off">{formatDuration(secondsLeft)} left</span>} />
      <AsyncState loading={questions.loading} error={questions.error} empty={list.length === 0} emptyTitle="Questions missing" emptyBody="This paper refers to questions that are no longer available.">
        {current && (
          <div className="card">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ink-500">Question {index + 1} of {list.length}</span>
              <Tag tone="neutral">{QUESTION_TYPE_LABELS[current.type]}</Tag>
              <Tag tone={current.difficulty === 3 ? "danger" : current.difficulty === 2 ? "warn" : "success"}>{DIFFICULTY_LABELS[current.difficulty]}</Tag>
            </div>
            <p className="mt-3 whitespace-pre-line text-base font-medium">{current.text}</p>
            <AnswerInput question={current} value={answers[current.id]} onChange={(value) => setAnswers((previous) => (value ? { ...previous, [current.id]: value } : Object.fromEntries(Object.entries(previous).filter(([key]) => key !== current.id))))} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button>
                <button type="button" className="btn-secondary" disabled={index + 1 >= list.length} onClick={() => setIndex(index + 1)}>Next</button>
              </div>
              <span className="text-sm text-ink-500">{answered} of {list.length} answered</span>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Question navigator">
          {list.map((question, position) => (
            <button key={question.id} type="button" aria-label={`Question ${position + 1}${answers[question.id] ? ", answered" : ""}`} aria-current={position === index} className={`h-8 w-8 rounded-lg text-xs font-semibold ${position === index ? "bg-brand-600 text-white" : answers[question.id] ? "bg-success-500/20 text-success-500" : "bg-ink-100 text-ink-700"}`} onClick={() => setIndex(position)}>{position + 1}</button>
          ))}
        </div>
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-700">Unanswered questions count as wrong. If submission fails your answers stay saved here so you can retry.</p>
          <button type="button" className="btn-primary" disabled={submit.busy} onClick={() => { if (answered === list.length || window.confirm(`${list.length - answered} unanswered. Submit anyway?`)) void submit.run(); }}>{submit.busy ? "Submitting..." : "Submit assessment"}</button>
        </div>
        <InlineError message={submit.error} />
        {submit.error && <button type="button" className="btn-secondary mt-2" onClick={() => void submit.run()}>Retry submission</button>}
      </AsyncState>
    </div>
  );
}

function AnswerInput({ question, value, onChange }: { question: QuestionDoc; value: SubmittedAnswer | undefined; onChange: (value: SubmittedAnswer | null) => void }) {
  if (question.type === "numerical") {
    const text = value && "value" in value ? value.value : "";
    return (
      <div className="mt-4">
        <label htmlFor={`a-${question.id}`} className="label">Your answer{question.unit ? ` (${question.unit})` : ""}</label>
        <input id={`a-${question.id}`} className="input max-w-xs" inputMode="decimal" value={text} onChange={(event) => onChange(event.target.value.trim() ? { value: event.target.value } : null)} />
      </div>
    );
  }
  const multi = question.type === "multi";
  const selected = value && "indexes" in value ? value.indexes : [];
  const toggle = (optionIndex: number) => {
    const next = multi ? (selected.includes(optionIndex) ? selected.filter((item) => item !== optionIndex) : [...selected, optionIndex].sort((left, right) => left - right)) : [optionIndex];
    onChange(next.length ? { indexes: next } : null);
  };
  return (
    <fieldset className="mt-4 space-y-2">
      <legend className="sr-only">{multi ? "Select all correct options" : "Select one option"}</legend>
      {multi && <p className="text-xs text-ink-500">Select all that apply.</p>}
      {question.options.map((option, optionIndex) => (
        <label key={optionIndex} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${selected.includes(optionIndex) ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-100"}`}>
          <input type={multi ? "checkbox" : "radio"} name={`a-${question.id}`} className="mt-0.5" checked={selected.includes(optionIndex)} onChange={() => toggle(optionIndex)} />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ResultView({ attempt, result, toast, onToastDone }: { attempt: AssessmentAttemptDoc; result?: AssessmentSubmitResult; toast?: OutcomeResult | null; onToastDone?: () => void }) {
  const questions = useContent(() => content.questionsById(attempt.questionIds), [attempt.id]);
  const topics = useContent(() => content.allTopics(), []);
  const chapters = useContent(() => content.allChapters(), []);
  const score = result?.score ?? attempt.score ?? 0;
  const total = result?.total ?? attempt.total ?? attempt.questionIds.length;
  const accuracy = total ? Math.round((score / total) * 100) : 0;
  const timeTaken = result?.timeTakenSec ?? attempt.timeTakenSec ?? 0;
  const results = result?.results ?? attempt.results ?? {};
  const summary = attempt.topicSummary ?? Object.fromEntries((result?.topics ?? []).map((topic) => [topic.topicId, { attempts: topic.attempts, correct: topic.correct }]));
  const topicRows = Object.entries(summary).map(([topicId, row]) => ({ topicId, ...row, accuracy: Math.round((row.correct / row.attempts) * 100), strength: result?.topics.find((topic) => topic.topicId === topicId)?.strength ?? null })).sort((left, right) => left.accuracy - right.accuracy);
  const meta = (topicId: string) => {
    const topic = topics.data?.find((item) => item.id === topicId);
    const chapter = topic ? chapters.data?.find((item) => item.id === topic.chapterId) : null;
    return { name: topic?.name ?? topicId, link: topic && chapter ? learnPath(chapter, topic) : "/learn" };
  };
  const strong = topicRows.filter((row) => row.accuracy >= 75);
  const weak = topicRows.filter((row) => row.accuracy < 50);
  const middle = topicRows.filter((row) => row.accuracy >= 50 && row.accuracy < 75);

  return (
    <div>
      <PageHeader title={`${ASSESSMENT_KIND_LABELS[attempt.kind]} result`} crumbs={[{ label: "Assessments", to: "/assessments" }]} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Score</p><p className="text-3xl font-bold">{score} / {total}</p></div>
        <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Accuracy</p><p className="text-3xl font-bold">{accuracy}%</p></div>
        <div className="card"><p className="text-xs uppercase tracking-wide text-ink-500">Time</p><p className="text-3xl font-bold">{formatDuration(timeTaken)}</p></div>
      </div>
      {result?.rewards && <p className="mt-3 text-sm text-ink-700">Earned +{result.rewards.xp} XP and +{result.rewards.coins} Orbit Coins.{result.rewards.streak.incremented ? ` Streak is now ${result.rewards.streak.current} days.` : ""}</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <TopicColumn title="Strong topics" rows={strong} meta={meta} empty="None above 75% in this paper." />
        <TopicColumn title="Weak topics" rows={weak} meta={meta} empty="No topic below 50%. Well done." />
        <div className="card">
          <h2 className="text-lg font-semibold">Recommended</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {weak.map((row) => <li key={row.topicId}>Revise <Link to={meta(row.topicId).link} className="text-brand-700 hover:underline">{meta(row.topicId).name}</Link> in Learn, then <Link to={`${meta(row.topicId).link}?tab=practice`} className="text-brand-700 hover:underline">practise</Link>.</li>)}
            {middle.map((row) => <li key={row.topicId}>Practise <Link to={`${meta(row.topicId).link}?tab=practice`} className="text-brand-700 hover:underline">{meta(row.topicId).name}</Link> to move it from {row.accuracy}% to strong.</li>)}
            {weak.length === 0 && middle.length === 0 && <li className="text-ink-500">Everything here is strong. Try a harder assessment or a new chapter.</li>}
          </ul>
          <Link to={`/orbitai?mode=mistake_analysis${weak[0] ? `&topicId=${weak[0].topicId}` : ""}`} className="btn-secondary mt-3">Ask OrbitAI to analyse mistakes</Link>
        </div>
      </div>
      <section className="card mt-4">
        <h2 className="text-lg font-semibold">Review</h2>
        <AsyncState loading={questions.loading} error={questions.error} skeletonLines={4}>
          <ol className="mt-3 space-y-4">
            {(questions.data ?? []).map((question, position) => {
              const outcome = results[question.id];
              const given = attempt.answers?.[question.id];
              return (
                <li key={question.id} className={`rounded-xl border p-4 text-sm ${outcome?.correct ? "border-success-500/50" : "border-danger-500/40"}`}>
                  <p className="font-medium"><span className="text-ink-500">{position + 1}.</span> {question.text}</p>
                  <p className="mt-2 text-ink-700"><span className="font-semibold">Your answer: </span>{describeAnswer(question, given)}</p>
                  {outcome && <p className="text-ink-700"><span className="font-semibold">Correct: </span>{question.type === "numerical" ? `${outcome.numericAnswer}${question.unit ? ` ${question.unit}` : ""}` : outcome.correctIndexes.map((optionIndex) => question.options[optionIndex]).join("; ")}</p>}
                  {outcome && <p className="mt-1 whitespace-pre-line text-ink-700"><span className="font-semibold">Why: </span>{outcome.explanation}</p>}
                  <Link to={`/orbitai?questionId=${question.id}&mode=${outcome?.correct ? "explain" : "mistake_analysis"}`} className="mt-2 inline-block text-xs text-brand-600 hover:underline">Ask OrbitAI about this question</Link>
                </li>
              );
            })}
          </ol>
        </AsyncState>
      </section>
      {toast !== undefined && onToastDone && <RewardToast result={toast ?? null} onDone={onToastDone} />}
    </div>
  );
}

function TopicColumn({ title, rows, meta, empty }: { title: string; rows: { topicId: string; accuracy: number; strength: string | null }[]; meta: (id: string) => { name: string; link: string }; empty: string }) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.length === 0 && <li className="text-ink-500">{empty}</li>}
        {rows.map((row) => (
          <li key={row.topicId} className="flex items-center justify-between gap-2">
            <Link to={meta(row.topicId).link} className="text-brand-700 hover:underline">{meta(row.topicId).name}</Link>
            <span className="flex items-center gap-2 text-xs text-ink-500">{row.accuracy}% {row.strength && row.strength !== "unrated" && <StrengthTag strength={row.strength as never} />}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeAnswer(question: QuestionDoc, answer: SubmittedAnswer | undefined): string {
  if (!answer) return "Not answered";
  if ("value" in answer) return answer.value;
  return answer.indexes.map((optionIndex) => question.options[optionIndex]).join("; ");
}
