import { Link, Navigate, useParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, examPath, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { CATEGORY_NAMES, isSubjectId, parseClassLevel, SUBJECT_NAMES } from "../lib/subjects";
import { useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, ContentPreparing, PageHeader, StrengthTag, Tag } from "../components/ui";
import type { ChapterDoc, ExamTag, LessonProgressDoc, TopicMasteryDoc } from "../lib/types";

/**
 * Chapter overview reached from Learn (class/subject/slug) or from JEE and NEET (subject/chapter id).
 * Shows overview, objectives, topics, formulas, key concepts, common mistakes and the chapter test entry.
 */
export default function ChapterPage({ examTag }: { examTag?: ExamTag }) {
  const params = useParams();
  const subjectId = isSubjectId(params.subjectId) ? params.subjectId : null;
  const classLevel = parseClassLevel(params.classLevel);
  const chapter = useContent(async () => {
    if (!subjectId) return null;
    if (examTag) return params.chapterId ? content.chapter(params.chapterId) : null;
    return classLevel && params.chapterSlug ? content.chapterBySlug(classLevel, subjectId, params.chapterSlug) : null;
  }, [subjectId, classLevel, params.chapterSlug, params.chapterId, examTag]);

  if (!subjectId) return <Navigate to={examTag ? `/${examTag}` : "/learn"} replace />;
  return (
    <AsyncState loading={chapter.loading} error={chapter.error} empty={!chapter.loading && !chapter.data} emptyTitle="Chapter not found" emptyBody="This chapter is not in the syllabus structure yet.">
      {chapter.data && <ChapterDetail chapter={chapter.data} examTag={examTag} />}
    </AsyncState>
  );
}

function ChapterDetail({ chapter, examTag }: { chapter: ChapterDoc; examTag?: ExamTag }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const topics = useContent(() => content.topics(chapter.id), [chapter.id]);
  const mastery = useQueryOnce<TopicMasteryDoc>(() => (uid ? query(collection(db, "topicMastery"), where("userId", "==", uid), where("chapterId", "==", chapter.id)) : null), [uid, chapter.id]);
  const lessons = useQueryOnce<LessonProgressDoc>(() => (uid ? query(collection(db, "lessonProgress"), where("userId", "==", uid), where("chapterId", "==", chapter.id)) : null), [uid, chapter.id]);
  const masteryByTopic = new Map(mastery.data.map((row) => [row.topicId, row]));
  const completedTopics = new Set(lessons.data.filter((row) => row.status === "completed").map((row) => row.topicId));
  const crumbs = examTag
    ? [{ label: examTag.toUpperCase(), to: `/${examTag}` }, { label: SUBJECT_NAMES[chapter.subjectId], to: examPath(examTag, chapter.subjectId) }]
    : [{ label: "Learn", to: "/learn" }, { label: `Class ${chapter.classLevel}`, to: `/learn/${chapter.classLevel}` }, { label: SUBJECT_NAMES[chapter.subjectId], to: `/learn/${chapter.classLevel}/${chapter.subjectId}` }];
  const topicPath = (slug: string) => (examTag ? `${learnPath(chapter, { slug })}?from=${examTag}` : learnPath(chapter, { slug }));
  const aiLink = `/orbitai?chapterId=${chapter.id}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={chapter.name}
        subtitle={<span>Class {chapter.classLevel} · {SUBJECT_NAMES[chapter.subjectId]}{chapter.category ? ` · ${CATEGORY_NAMES[chapter.category]}` : ""} · {chapter.examTags.map((tag) => tag.toUpperCase()).join(", ")}</span>}
        crumbs={crumbs}
        action={<Link to={aiLink} className="btn-secondary">Ask OrbitAI about this chapter</Link>}
      />
      {!chapter.hasContent && <ContentPreparing what="this chapter" />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {chapter.overview && (
            <section className="card">
              <h2 className="text-lg font-semibold">Overview</h2>
              <p className="mt-2 text-sm text-ink-700">{chapter.overview}</p>
              {chapter.objectives.length > 0 && (
                <>
                  <h3 className="mt-4 text-sm font-semibold">Learning objectives</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{chapter.objectives.map((item) => <li key={item}>{item}</li>)}</ul>
                </>
              )}
            </section>
          )}
          <section className="card">
            <h2 className="text-lg font-semibold">Topics</h2>
            <AsyncState loading={topics.loading} error={topics.error} empty={(topics.data ?? []).length === 0} emptyTitle="No topics authored yet" emptyBody="Content for this chapter is being prepared.">
              <ol className="mt-3 divide-y divide-ink-200">
                {(topics.data ?? []).map((topic) => {
                  const row = masteryByTopic.get(topic.id);
                  return (
                    <li key={topic.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <Link to={topicPath(topic.slug)} className="font-semibold text-brand-700 hover:underline">{topic.order}. {topic.name}</Link>
                        <p className="text-xs text-ink-500">{topic.hasContent ? "Lesson, practice and quick test" : "Being prepared"}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {completedTopics.has(topic.id) && <Tag tone="success">Lesson done</Tag>}
                        {row ? <span className="flex items-center gap-1 text-ink-500">Mastery {Math.round(row.mastery)} <StrengthTag strength={row.strength} /></span> : topic.hasContent ? <Tag tone="neutral">Not started</Tag> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </AsyncState>
          </section>
          {(chapter.keyConcepts.length > 0 || chapter.commonMistakes.length > 0) && (
            <section className="card grid gap-4 sm:grid-cols-2">
              {chapter.keyConcepts.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">Key concepts</h2>
                  <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">{chapter.keyConcepts.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              {chapter.commonMistakes.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">Common mistakes</h2>
                  <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">{chapter.commonMistakes.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
            </section>
          )}
        </div>
        <aside className="space-y-4">
          {chapter.formulas.length > 0 && (
            <section className="card">
              <h2 className="text-lg font-semibold">Important formulas</h2>
              <ul className="mt-2 space-y-1 font-mono text-sm text-ink-700">{chapter.formulas.map((item) => <li key={item} className="rounded bg-brand-50 px-2 py-1">{item}</li>)}</ul>
            </section>
          )}
          <section className="card">
            <h2 className="text-lg font-semibold">Practice and test</h2>
            <p className="mt-1 text-sm text-ink-500">Practice pulls from every topic in this chapter. The chapter test is a timed assessment.</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link to={`/practice?chapterId=${chapter.id}`} className="btn-primary">Practice this chapter</Link>
              <Link to={`/assessments?kind=chapter_test&scopeId=${chapter.id}`} className="btn-secondary">Chapter test</Link>
              {examTag && <Link to={`/practice?chapterId=${chapter.id}&pyq=1`} className="btn-secondary">Previous year questions</Link>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
