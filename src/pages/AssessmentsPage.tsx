import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { api } from "../lib/callables";
import { db } from "../lib/firebase";
import { timeAgo } from "../lib/format";
import { SUBJECT_NAMES } from "../lib/subjects";
import { useAction, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, InlineError, PageHeader, Tag } from "../components/ui";
import { ASSESSMENT_KIND_LABELS, DIFFICULTY_LABELS, type AssessmentAttemptDoc, type AssessmentDoc, type AssessmentKind, type Difficulty } from "../lib/types";

const PERIODIC: AssessmentKind[] = ["daily", "weekly", "monthly"];

/**
 * Assessment catalogue and history. Starting builds the question set on the server (one paper per
 * period for daily, weekly and monthly). Arriving with ?kind=topic_test&scopeId=... starts that test.
 */
export default function AssessmentsPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedKind = params.get("kind") as AssessmentKind | null;
  const scopeId = params.get("scopeId");
  const assessments = useContent(() => content.assessments(), []);
  const history = useQueryOnce<AssessmentAttemptDoc>(() => (uid ? query(collection(db, "assessmentAttempts"), where("userId", "==", uid), orderBy("createdAt", "desc"), limit(20)) : null), [uid]);
  const scopeName = useContent(async () => {
    if (!scopeId) return null;
    if (requestedKind === "topic_test") return (await content.topic(scopeId))?.name ?? null;
    if (requestedKind === "chapter_test") return (await content.chapter(scopeId))?.name ?? null;
    return null;
  }, [scopeId, requestedKind]);
  const [starting, setStarting] = useState<string | null>(null);
  const start = useAction(async (assessment: AssessmentDoc) => {
    setStarting(assessment.id);
    const needsScope = assessment.kind === "topic_test" || assessment.kind === "chapter_test";
    const result = await api.startAssessment({ assessmentId: assessment.id, scopeId: needsScope ? scopeId : null });
    navigate(`/assessments/${result.attemptId}`);
    return result;
  });
  useEffect(() => {
    if (!start.busy) setStarting(null);
  }, [start.busy]);

  const todaysAttempt = (kind: AssessmentKind) => history.data.find((attempt) => attempt.kind === kind && PERIODIC.includes(kind) && isCurrentPeriod(attempt));
  const eligible = (assessment: AssessmentDoc) => {
    if (assessment.examTag === "jee" && !profile?.goal.includes("jee")) return "Your goal does not include JEE. Change it in Settings to take JEE mocks.";
    if (assessment.examTag === "neet" && !profile?.goal.includes("neet")) return "Your goal does not include NEET. Change it in Settings to take NEET mocks.";
    if ((assessment.kind === "topic_test" || assessment.kind === "chapter_test") && !(requestedKind === assessment.kind && scopeId)) return "Open this from a topic or chapter page.";
    return null;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Assessments" subtitle="Papers are built on the server from real questions. Results update topic mastery and your recommendations." />
      {scopeId && scopeName.data && <p className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">Ready to test <span className="font-semibold">{scopeName.data}</span>. Start the {ASSESSMENT_KIND_LABELS[requestedKind ?? "topic_test"]} below.</p>}
      <AsyncState loading={assessments.loading || history.loading} error={assessments.error ?? history.error} empty={(assessments.data ?? []).length === 0} emptyTitle="No assessment templates" emptyBody="Run the seed script to load templates.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {(assessments.data ?? []).filter((assessment) => !requestedKind || assessment.kind === requestedKind || !["topic_test", "chapter_test"].includes(assessment.kind)).map((assessment) => {
            const total = Object.values(assessment.questionCounts).reduce((sum, count) => sum + count, 0);
            const done = todaysAttempt(assessment.kind);
            const problem = eligible(assessment);
            const highlight = requestedKind === assessment.kind;
            return (
              <li key={assessment.id} className={`card flex flex-col ${highlight ? "border-brand-500" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold">{assessment.title}</h2>
                  {assessment.examTag && <Tag tone="brand">{assessment.examTag.toUpperCase()}</Tag>}
                </div>
                <p className="mt-1 flex-1 text-sm text-ink-700">{assessment.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {total} questions · {Math.round(assessment.timeLimitSec / 60)} min · {(Object.keys(assessment.questionCounts) as ("1" | "2" | "3")[]).map((level) => `${assessment.questionCounts[level]} ${DIFFICULTY_LABELS[Number(level) as Difficulty]}`).join(", ")}
                  {assessment.subjectIds.length > 0 && ` · ${assessment.subjectIds.map((subject) => SUBJECT_NAMES[subject]).join(", ")}`}
                </p>
                {problem && <p className="mt-2 text-xs text-warn-500">{problem}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {done?.finalized ? (
                    <Link to={`/assessments/${done.id}`} className="btn-secondary">Done for this period: {done.score}/{done.total}. View</Link>
                  ) : done ? (
                    <Link to={`/assessments/${done.id}`} className="btn-primary">Resume</Link>
                  ) : (
                    <button type="button" className="btn-primary" disabled={Boolean(problem) || start.busy} onClick={() => void start.run(assessment)}>{starting === assessment.id ? "Building paper..." : "Start"}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <InlineError message={start.error} />
      </AsyncState>

      <section className="card mt-6" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">Your assessments</h2>
        <AsyncState loading={history.loading} error={history.error} onRetry={history.reload} empty={history.data.length === 0} emptyTitle="No assessments yet" emptyBody="Complete a few assessments and EduOrbit will identify where you need more practice." skeletonLines={2}>
          <ul className="mt-3 divide-y divide-ink-200 text-sm">
            {history.data.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link to={`/assessments/${attempt.id}`} className="font-medium text-brand-700 hover:underline">{ASSESSMENT_KIND_LABELS[attempt.kind]}</Link>
                <span className="text-ink-500">{timeAgo(attempt.createdAt)}</span>
                {attempt.finalized ? <Tag tone={attempt.score !== null && attempt.total && attempt.score / attempt.total >= 0.75 ? "success" : "neutral"}>{attempt.score} / {attempt.total}</Tag> : <Tag tone="warn">In progress</Tag>}
              </li>
            ))}
          </ul>
        </AsyncState>
      </section>
    </div>
  );
}

function isCurrentPeriod(attempt: AssessmentAttemptDoc): boolean {
  if (!attempt.periodKey) return false;
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const today = now.toISOString().slice(0, 10);
  if (attempt.kind === "daily") return attempt.periodKey === today;
  if (attempt.kind === "monthly") return attempt.periodKey === today.slice(0, 7);
  const createdMs = toMillis(attempt.createdAt);
  return createdMs !== null && Date.now() - createdMs < 7 * 86_400_000;
}

function toMillis(value: unknown): number | null {
  return typeof value === "object" && value !== null && typeof (value as { toMillis?: unknown }).toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;
}
