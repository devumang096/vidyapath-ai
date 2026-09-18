import { Link, useSearchParams } from "react-router-dom";
import { content, useContent } from "../lib/content";
import { SUBJECT_NAMES } from "../lib/subjects";
import { AsyncState, PageHeader, Tag } from "../components/ui";
import { DIFFICULTY_LABELS, type Difficulty } from "../lib/types";

/**
 * Assessment catalogue. Starting and submitting assessments (server-built question sets, one daily,
 * weekly and monthly per period, scoring with strong and weak topics) ships in the next build phase;
 * until then this page states that plainly instead of offering a button that does nothing.
 */
export default function AssessmentsPage() {
  const [params] = useSearchParams();
  const requested = params.get("kind");
  const assessments = useContent(() => content.assessments(), []);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Assessments" subtitle="Daily, weekly and monthly assessments, topic and chapter tests, and JEE or NEET mocks. Results feed topic mastery and recommendations." />
      <div className="card mb-4 border-warn-500/40 bg-warn-500/10 text-sm text-ink-700" role="status">
        <p className="font-semibold">Assessments open in the next release of this build.</p>
        <p className="mt-1">The templates below are live data from the assessments collection. The start and submit flow (server-built question sets, timer, answer preservation, scoring with strong and weak topics) is the next phase. Until then, use <Link to="/practice" className="text-brand-600 underline">Practice</Link> for graded questions.</p>
        {requested && <p className="mt-1">You arrived here for a {requested.replace(/_/g, " ")}; it will start from this page once the flow ships.</p>}
      </div>
      <AsyncState loading={assessments.loading} error={assessments.error} empty={(assessments.data ?? []).length === 0} emptyTitle="No assessment templates" emptyBody="Run the seed script to load templates.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {(assessments.data ?? []).map((assessment) => {
            const total = Object.values(assessment.questionCounts).reduce((sum, count) => sum + count, 0);
            return (
              <li key={assessment.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold">{assessment.title}</h2>
                  {assessment.examTag && <Tag tone="brand">{assessment.examTag.toUpperCase()}</Tag>}
                </div>
                <p className="mt-1 text-sm text-ink-700">{assessment.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {total} questions · {Math.round(assessment.timeLimitSec / 60)} min · {(Object.keys(assessment.questionCounts) as ("1" | "2" | "3")[]).map((level) => `${assessment.questionCounts[level]} ${DIFFICULTY_LABELS[Number(level) as Difficulty]}`).join(", ")}
                  {assessment.subjectIds.length > 0 && ` · ${assessment.subjectIds.map((subject) => SUBJECT_NAMES[subject]).join(", ")}`}
                </p>
              </li>
            );
          })}
        </ul>
      </AsyncState>
    </div>
  );
}
