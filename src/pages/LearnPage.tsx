import { Link, Navigate, useParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { CATEGORY_NAMES, CLASS_LEVELS, isSubjectId, parseClassLevel, SUBJECT_IDS, SUBJECT_NAMES } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, PageHeader, ProgressBar, Tag } from "../components/ui";
import type { ChapterDoc, ChapterProgressDoc, SubjectId } from "../lib/types";

/** Learn hub: class picker, then subject picker, then the chapter list for that class and subject. */
export default function LearnPage() {
  const params = useParams();
  const { profile } = useAuth();
  const classLevel = parseClassLevel(params.classLevel);
  const subjectId = isSubjectId(params.subjectId) ? params.subjectId : null;

  if (params.classLevel && !classLevel) return <Navigate to="/learn" replace />;
  if (params.subjectId && !subjectId) return <Navigate to={`/learn/${params.classLevel}`} replace />;

  if (!classLevel) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Learn" subtitle="Classes 9 to 12. Physics, Chemistry, Mathematics and Biology, chapter by chapter." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CLASS_LEVELS.map((level) => (
            <Link key={level} to={`/learn/${level}`} className={`card block hover:border-brand-500 ${profile?.classLevel === level ? "border-brand-500" : ""}`}>
              <p className="text-2xl font-bold">Class {level}</p>
              <p className="mt-1 text-sm text-ink-500">{SUBJECT_IDS.map((subject) => SUBJECT_NAMES[subject]).join(" · ")}</p>
              {profile?.classLevel === level && <Tag tone="brand">Your class</Tag>}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (!subjectId) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title={`Class ${classLevel}`} subtitle="Choose a subject." crumbs={[{ label: "Learn", to: "/learn" }]} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SUBJECT_IDS.map((subject) => (
            <Link key={subject} to={`/learn/${classLevel}/${subject}`} className={`card block hover:border-brand-500 ${profile?.subjects.includes(subject) ? "" : "opacity-80"}`}>
              <p className="text-xl font-bold">{SUBJECT_NAMES[subject]}</p>
              {profile?.subjects.includes(subject) && <Tag tone="brand">On your path</Tag>}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return <ChapterList classLevel={classLevel} subjectId={subjectId} />;
}

function ChapterList({ classLevel, subjectId }: { classLevel: 9 | 10 | 11 | 12; subjectId: SubjectId }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const chapters = useContent(() => content.chapters(classLevel, subjectId), [classLevel, subjectId]);
  const progress = useQueryOnce<ChapterProgressDoc>(() => (uid ? query(collection(db, "chapterProgress"), where("userId", "==", uid), where("subjectId", "==", subjectId)) : null), [uid, subjectId]);
  const progressByChapter = new Map(progress.data.map((row) => [row.chapterId, row]));
  const grouped = groupByCategory(chapters.data ?? []);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`${SUBJECT_NAMES[subjectId]} · Class ${classLevel}`} subtitle={`${chapters.data?.length ?? 0} chapters. Chapters marked "Preparing" have their structure ready but no authored lessons yet.`} crumbs={[{ label: "Learn", to: "/learn" }, { label: `Class ${classLevel}`, to: `/learn/${classLevel}` }]} />
      <AsyncState loading={chapters.loading} error={chapters.error} empty={(chapters.data ?? []).length === 0} emptyTitle="No chapters yet" emptyBody="Content for this subject is being prepared.">
        {grouped.map(([category, rows]) => (
          <section key={category ?? "all"} className="mb-6">
            {category && <h2 className="mb-2 text-lg font-semibold">{CATEGORY_NAMES[category as keyof typeof CATEGORY_NAMES]}</h2>}
            <ol className="grid gap-3 sm:grid-cols-2">
              {rows.map((chapter) => {
                const row = progressByChapter.get(chapter.id);
                return (
                  <li key={chapter.id}>
                    <Link to={learnPath(chapter)} className="card block h-full hover:border-brand-500">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold"><span className="text-ink-500">{chapter.order}.</span> {chapter.name}</p>
                        {chapter.hasContent ? (row?.completed ? <Tag tone="success">Completed</Tag> : <Tag tone="brand">Ready</Tag>) : <Tag tone="neutral">Preparing</Tag>}
                      </div>
                      {row && row.lessonsTotal > 0 && <div className="mt-3"><ProgressBar value={(row.lessonsCompleted / row.lessonsTotal) * 100} label={`${row.lessonsCompleted} of ${row.lessonsTotal} lessons`} tone={row.completed ? "success" : "brand"} /></div>}
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

function groupByCategory(chapters: ChapterDoc[]): [string | null, ChapterDoc[]][] {
  const groups = new Map<string | null, ChapterDoc[]>();
  for (const chapter of chapters) {
    const list = groups.get(chapter.category) ?? [];
    list.push(chapter);
    groups.set(chapter.category, list);
  }
  return [...groups.entries()];
}
