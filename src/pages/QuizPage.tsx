import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type OutcomeResult, type QuizResults } from "../lib/callables";
import { content, useContent } from "../lib/content";
import { formatDuration, newId } from "../lib/format";
import { useAction } from "../hooks/useFirestore";
import { AsyncState, InlineError, PageHeader, RewardToast, Tag } from "../components/ui";
import { LEVEL_NAMES, type Level } from "../lib/types";

interface QuizOutcome {
  score: number;
  total: number;
  results: QuizResults;
  firstCompletion: boolean;
  levelUnlocked?: Level;
}

export default function QuizPage() {
  const { quizId = "" } = useParams<{ quizId: string }>();
  const quiz = useContent(() => content.quiz(quizId), [quizId]);
  const questions = useContent(() => (quiz.data ? content.questions(quiz.data.questionIds) : Promise.resolve([])), [quiz.data?.id]);
  const attemptId = useRef(newId());
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);
  const [toast, setToast] = useState<OutcomeResult | null>(null);

  const submit = useAction(
    useCallback(async () => {
      const result = await api.finalizeQuiz({ attemptId: attemptId.current, quizId, answers });
      setOutcome({ score: result.score, total: result.total, results: result.results, firstCompletion: result.firstCompletion ?? false, levelUnlocked: result.levelUnlocked });
      if (result.rewards && !result.alreadyFinalized) setToast(result.rewards);
      return result;
    }, [quizId, answers])
  );
  const submitRef = useRef(submit.run);
  submitRef.current = submit.run;

  useEffect(() => {
    if (!quiz.data || outcome) return;
    setSecondsLeft(quiz.data.timeLimitSec);
    const timer = setInterval(() => {
      setSecondsLeft((previous) => {
        if (previous === null) return previous;
        if (previous <= 1) {
          clearInterval(timer);
          submitRef.current();
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.data?.id]);

  const list = questions.data ?? [];
  const answered = Object.keys(answers).length;

  return (
    <AsyncState loading={quiz.loading || questions.loading} error={quiz.error ?? questions.error} empty={!quiz.loading && !quiz.data} emptyTitle="Quiz not found">
      {quiz.data && (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title={quiz.data.title}
            subtitle={<>Level {quiz.data.level} {LEVEL_NAMES[quiz.data.level]} · {list.length} questions · <Link to={`/learn/topic/${quiz.data.topicId}`} className="text-brand-700">Back to topic</Link></>}
            action={!outcome && secondsLeft !== null ? <Tag tone={secondsLeft < 30 ? "danger" : "brand"}>Time left {formatDuration(secondsLeft)}</Tag> : undefined}
          />
          {list.length === 0 ? (
            <div className="card text-sm text-ink-500">This quiz has no questions yet.</div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!outcome) submit.run();
              }}
              className="space-y-4"
            >
              {list.map((question, index) => {
                const result = outcome?.results[question.id];
                return (
                  <fieldset key={question.id} className={`card ${result ? (result.correct ? "border-success-500" : "border-danger-500") : ""}`} disabled={Boolean(outcome)}>
                    <legend className="font-semibold">{index + 1}. {question.text}</legend>
                    <div className="mt-2 space-y-1">
                      {question.options.map((option, optionIndex) => {
                        const chosen = answers[question.id] === optionIndex;
                        const isCorrect = result?.correctIndex === optionIndex;
                        return (
                          <label key={optionIndex} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${isCorrect ? "bg-success-500/15" : chosen && result && !result.correct ? "bg-danger-500/15" : chosen ? "bg-brand-50" : "hover:bg-ink-100"}`}>
                            <input type="radio" name={question.id} checked={chosen} onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: optionIndex }))} />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                    {result && <p className="mt-2 text-sm text-ink-700"><span className="font-medium">{result.correct ? "Correct." : "Incorrect."}</span> {result.explanation}</p>}
                  </fieldset>
                );
              })}
              {outcome ? (
                <div className="card">
                  <p className="text-xl font-bold">Score {outcome.score} / {outcome.total} ({Math.round((outcome.score / Math.max(1, outcome.total)) * 100)}%)</p>
                  {!outcome.firstCompletion && <p className="mt-1 text-sm text-ink-500">Practice attempt: no XP this time. Your accuracy and streak still count.</p>}
                  {outcome.levelUnlocked && <p className="mt-1 text-sm text-ink-700">Level unlocked: {outcome.levelUnlocked} ({LEVEL_NAMES[outcome.levelUnlocked]})</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/learn/topic/${quiz.data.topicId}`} className="btn-secondary">Back to topic</Link>
                    <Link to={`/problem-lab?topic=${quiz.data.topicId}`} className="btn-primary">Practice in Problem Lab</Link>
                  </div>
                </div>
              ) : (
                <div className="card">
                  <p className="text-sm text-ink-500">{answered} of {list.length} answered. Unanswered questions count as wrong. The quiz is scored once; you cannot resubmit this attempt.</p>
                  <InlineError message={submit.error} />
                  <button type="submit" className="btn-primary mt-3" disabled={submit.busy}>{submit.busy ? "Scoring..." : "Submit quiz"}</button>
                </div>
              )}
            </form>
          )}
          <RewardToast result={toast} onDone={() => setToast(null)} />
        </div>
      )}
    </AsyncState>
  );
}
