import { Link, Navigate, useParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, examPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { CATEGORY_NAMES, isSubjectId, SUBJECT_NAMES, SUBJECTS_BY_PATH } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, PageHeader, StrengthTag, Tag } from "../components/ui";
import type { ChapterDoc, ExamTag, SubjectId, TopicMasteryDoc } from "../lib/types";

const EXAM_COPY: Record<"jee" | "neet", { title: string; blurb: string; structure: string }> = {
  jee: { title: "JEE", blurb: "JEE Main and JEE Advanced preparation in Physics, Chemistry (Physical, Organic, Inorganic) and Mathematics.", structure: "Exam → Subject → Chapter → Topic → Concept → Practice → PYQ → Test → Mock" },
  neet: { title: "NEET", blurb: "NCERT-focused NEET preparation in Physics, Chemistry and Biology (Botany, Zoology).", structure: "Exam → Subject → Chapter → Topic → Practice → PYQ → Chapter Test → Mock Test" }
};

/** JEE and NEET hubs. Subjects are fixed per exam; chapters come from Class 11 and 12 content tagged for the exam. */
export default function ExamPage({ examTag }: { examTag: "jee" | "neet" }) {
  const params = useParams();
  const subjectId = isSubjectId(params.subjectId) ? params.subjectId : null;
  const allowed = SUBJECTS_BY_PATH[examTag];
  const copy = EXAM_COPY[examTag];
  if (params.subjectId && (!subjectId || !allowed.includes(subjectId))) return <Navigate to={`/${examTag}`} replace />;

  if (!subjectId) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title={copy.title} subtitle={copy.blurb} action={<Link to={`/assessments?kind=${examTag}_mock`} className="btn-primary">{copy.title} Mock</Link>} />
        <p className="mb-4 text-sm text-ink-500">{copy.structure}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {allowed.map((subject) => (
            <Link key={subject} to={examPath(examTag, subject)} className="card block hover:border-brand-500">
              <p className="text-xl font-bold">{SUBJECT_NAMES[subject]}</p>
              <p className="mt-1 text-sm text-ink-500">{subjectCategories(subject)}</p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-ink-500">EduOrbit does not publish official exam statistics. Track your own accuracy, time and mastery per chapter instead.</p>
      </div>
    );
  }
  return <ExamSubject examTag={examTag} subjectId={subjectId} />;
}

function subjectCategories(subject: SubjectId): string {
  if (subject === "chemistry") return "Physical · Organic · Inorganic";
  if (subject === "biology") return "Botany · Zoology";
  return "Class 11 and 12 chapters";
}

function ExamSubject({ examTag, subjectId }: { examTag: ExamTag; subjectId: SubjectId }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const chapters = useContent(() => content.chaptersForExam(examTag, subjectId), [examTag, subjectId]);
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid ? query(collection(db, "topicMastery"), where("userId", "==", uid), where("subjectId", "==", subjectId)) : null), [uid, subjectId]);
  const byChapter = new Map<string, TopicMasteryDoc[]>();
  for (const row of mastery.data) byChapter.set(row.chapterId, [...(byChapter.get(row.chapterId) ?? []), row]);
  const groups = new Map<string | null, ChapterDoc[]>();
  for (const chapter of chapters.data ?? []) groups.set(chapter.category, [...(groups.get(chapter.category) ?? []), chapter]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`${SUBJECT_NAMES[subjectId]} for ${examTag.toUpperCase()}`} subtitle="Class 11 and 12 chapters tagged for this exam. Your accuracy and mastery per chapter come from real attempts." crumbs={[{ label: examTag.toUpperCase(), to: `/${examTag}` }]} action={<Link to={`/practice?classLevel=11&subjectId=${subjectId}`} className="btn-secondary">Practice {SUBJECT_NAMES[subjectId]}</Link>} />
      <AsyncState loading={chapters.loading} error={chapters.error} empty={(chapters.data ?? []).length === 0} emptyTitle="No chapters tagged yet" emptyBody="Content for this exam subject is being prepared.">
        {[...groups.entries()].map(([category, rows]) => (
          <section key={category ?? "all"} className="mb-6">
            {category && <h2 className="mb-2 text-lg font-semibold">{CATEGORY_NAMES[category as keyof typeof CATEGORY_NAMES]}</h2>}
            <ol className="grid gap-3 sm:grid-cols-2">
              {rows.map((chapter) => {
                const topicRows = byChapter.get(chapter.id) ?? [];
                const attempts = topicRows.reduce((sum, row) => sum + row.attempts, 0);
                const correct = topicRows.reduce((sum, row) => sum + row.correct, 0);
                const average = topicRows.length ? topicRows.reduce((sum, row) => sum + row.mastery, 0) / topicRows.length : null;
                const weakest = [...topicRows].sort((left, right) => left.mastery - right.mastery)[0];
                return (
                  <li key={chapter.id}>
                    <Link to={examPath(examTag, subjectId, chapter)} className="card block h-full hover:border-brand-500">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{chapter.name} <span className="text-xs text-ink-500">Class {chapter.classLevel}</span></p>
                        {chapter.hasContent ? <Tag tone="brand">Ready</Tag> : <Tag tone="neutral">Preparing</Tag>}
                      </div>
                      {attempts > 0 ? (
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                          {attempts} attempts · {Math.round((correct / attempts) * 100)}% accuracy · mastery {Math.round(average ?? 0)}
                          {weakest && <StrengthTag strength={weakest.strength} />}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-ink-500">No attempts yet</p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </AsyncState>
    </div>
  );
}
