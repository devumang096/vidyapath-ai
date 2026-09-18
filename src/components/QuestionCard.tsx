import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type SubmitAnswerResponse } from "../lib/callables";
import { newId } from "../lib/format";
import { useAction } from "../hooks/useFirestore";
import { InlineError, StrengthTag, Tag } from "./ui";
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, type QuestionDoc, type SubmittedAnswer } from "../lib/types";

export interface AnsweredEvent {
  question: QuestionDoc;
  response: SubmitAnswerResponse;
}

/**
 * Renders one question of any type, collects an answer, submits it for server grading and shows
 * the explanation. The answer draft is kept in local state only; the attempt id is created once
 * so a retried request cannot double-count.
 */
export function QuestionCard({
  question,
  index,
  total,
  context,
  onAnswered,
  onNext,
  onTrySimilar,
  askAiPath
}: {
  question: QuestionDoc;
  index?: number;
  total?: number;
  context: "practice" | "topic";
  onAnswered?: (event: AnsweredEvent) => void;
  onNext?: () => void;
  onTrySimilar?: () => void;
  askAiPath: string;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [value, setValue] = useState("");
  const [response, setResponse] = useState<SubmitAnswerResponse | null>(null);
  const attemptId = useRef(newId());
  const startedAt = useRef(Date.now());
  const submit = useAction(async (answer: SubmittedAnswer) =>
    api.submitAnswer({ attemptId: attemptId.current, questionId: question.id, answer, timeTakenSec: Math.round((Date.now() - startedAt.current) / 1000), context })
  );

  useEffect(() => {
    setSelected([]);
    setValue("");
    setResponse(null);
    attemptId.current = newId();
    startedAt.current = Date.now();
  }, [question.id]);

  const multi = question.type === "multi";
  const numerical = question.type === "numerical";

  function toggle(optionIndex: number) {
    if (response) return;
    setSelected((previous) => (multi ? (previous.includes(optionIndex) ? previous.filter((item) => item !== optionIndex) : [...previous, optionIndex]) : [optionIndex]));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (response || submit.busy) return;
    const answer: SubmittedAnswer = numerical ? { value: value.trim() } : { indexes: [...selected].sort((left, right) => left - right) };
    if (numerical ? !value.trim() : selected.length === 0) return;
    const result = await submit.run(answer);
    if (result) {
      setResponse(result);
      onAnswered?.({ question, response: result });
    }
  }

  const optionState = (optionIndex: number) => {
    if (!response) return selected.includes(optionIndex) ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-100";
    const isCorrect = response.correctIndexes.includes(optionIndex);
    const wasChosen = selected.includes(optionIndex);
    if (isCorrect) return "border-success-500 bg-success-500/10";
    if (wasChosen) return "border-danger-500 bg-danger-500/10";
    return "border-ink-200 opacity-70";
  };

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {index !== undefined && total !== undefined && <span className="font-semibold text-ink-500">Question {index + 1} of {total}</span>}
        <Tag tone="neutral">{QUESTION_TYPE_LABELS[question.type]}</Tag>
        <Tag tone={question.difficulty === 3 ? "danger" : question.difficulty === 2 ? "warn" : "success"}>{DIFFICULTY_LABELS[question.difficulty]}</Tag>
        {question.pyq && <Tag tone="brand">PYQ</Tag>}
      </div>
      <p className="mt-3 whitespace-pre-line text-base font-medium text-ink-900">{question.text}</p>
      {numerical ? (
        <div className="mt-4">
          <label htmlFor={`answer-${question.id}`} className="label">Your answer{question.unit ? ` (${question.unit})` : ""}</label>
          <input id={`answer-${question.id}`} className="input max-w-xs" inputMode="decimal" value={value} disabled={Boolean(response)} onChange={(event) => setValue(event.target.value)} placeholder="Enter a number" />
        </div>
      ) : (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">{multi ? "Select all correct options" : "Select one option"}</legend>
          {multi && <p className="text-xs text-ink-500">Select all that apply.</p>}
          {question.options.map((option, optionIndex) => (
            <label key={optionIndex} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${optionState(optionIndex)}`}>
              <input type={multi ? "checkbox" : "radio"} name={`q-${question.id}`} className="mt-0.5" checked={selected.includes(optionIndex)} disabled={Boolean(response)} onChange={() => toggle(optionIndex)} />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      )}
      <InlineError message={submit.error} />
      {!response ? (
        <button type="submit" className="btn-primary mt-4" disabled={submit.busy || (numerical ? !value.trim() : selected.length === 0)}>{submit.busy ? "Checking..." : "Submit answer"}</button>
      ) : (
        <div className="mt-4 rounded-xl border border-ink-200 bg-ink-100 p-4 text-sm" role="status">
          <p className={`font-semibold ${response.correct ? "text-success-500" : "text-danger-500"}`}>
            {response.alreadySubmitted ? "This attempt was already recorded." : response.correct ? "Correct!" : "Not quite."}
            {response.rewarded && response.rewards && <span className="ml-2 text-ink-700">+{response.rewards.xp} XP · +{response.rewards.coins} Orbit Coins</span>}
          </p>
          <p className="mt-1 text-ink-700">
            <span className="font-semibold">Correct answer: </span>
            {numerical ? `${response.numericAnswer}${question.unit ? ` ${question.unit}` : ""}` : response.correctIndexes.map((optionIndex) => question.options[optionIndex]).join("; ")}
          </p>
          <p className="mt-2 whitespace-pre-line text-ink-700"><span className="font-semibold">Why: </span>{response.explanation}</p>
          <p className="mt-2 flex items-center gap-2 text-xs text-ink-500">Topic mastery now {Math.round(response.mastery)} <StrengthTag strength={response.strength} /></p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onTrySimilar && <button type="button" className="btn-secondary" onClick={onTrySimilar}>Try similar</button>}
            <Link to={`${askAiPath}${askAiPath.includes("?") ? "&" : "?"}questionId=${question.id}&mode=${response.correct ? "explain" : "mistake_analysis"}`} className="btn-secondary">Ask OrbitAI</Link>
            {onNext && <button type="button" className="btn-primary" onClick={onNext}>Next question</button>}
          </div>
        </div>
      )}
    </form>
  );
}
