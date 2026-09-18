import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { formatDuration } from "../lib/format";
import { isSubjectId, parseClassLevel, SUBJECT_NAMES } from "../lib/subjects";
import { useDoc, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, ContentPreparing, PageHeader, RewardToast, StrengthTag, Tabs, Tag } from "../components/ui";
import { LessonView } from "../components/LessonView";
import { QuestionCard } from "../components/QuestionCard";
import { conversationIdFor, OrbitAiPanel } from "../components/OrbitAiPanel";
import { StudyTimer } from "../components/StudyTimer";
import type { OutcomeResult } from "../lib/callables";
import { DIFFICULTY_LABELS, type ChapterDoc, type Difficulty, type LessonProgressDoc, type QuestionDoc, type TopicDoc, type TopicMasteryDoc } from "../lib/types";

type Tab = "learn" | "practice" | "orbitai" | "test" | "progress";
const TABS: { id: Tab; label: string }[] = [
  { id: "learn", label: "Learn" },
  { id: "practice", label: "Practice" },
  { id: "orbitai", label: "OrbitAI" },
  { id: "test", label: "Quick Test" },
  { id: "progress", label: "Progress" }
];

export default function TopicPage() {
  const params = useParams();
  const subjectId = isSubjectId(params.subjectId) ? params.subjectId : null;
  const classLevel = parseClassLevel(params.classLevel);
  const loaded = useContent(async () => {
    if (!subjectId || !classLevel || !params.chapterSlug || !params.topicSlug) return null;
    const chapter = await content.chapterBySlug(classLevel, subjectId, params.chapterSlug);
    if (!chapter) return null;
    const topic = await content.topicBySlug(chapter.id, params.topicSlug);
    return topic ? { chapter, topic } : null;
  }, [subjectId, classLevel, params.chapterSlug, params.topicSlug]);
  if (!subjectId || !classLevel) return <Navigate to="/learn" replace />;
  return (
    <AsyncState loading={loaded.loading} error={loaded.error} empty={!loaded.loading && !loaded.data} emptyTitle="Topic not found" emptyBody="This topic is not in the syllabus structure yet.">
      {loaded.data && <TopicDetail chapter={loaded.data.chapter} topic={loaded.data.topic} />}
    </AsyncState>
  );
}

function TopicDetail({ chapter, topic }: { chapter: ChapterDoc; topic: TopicDoc }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.some((item) => item.id === searchParams.get("tab")) ? searchParams.get("tab") : "learn") as Tab;
  const [toast, setToast] = useState<OutcomeResult | null>(null);
  const mastery = useDoc<TopicMasteryDoc>(uid ? `topicMastery/${uid}_${topic.id}` : null);
  const lessons = useContent(() => content.lessons(topic.id), [topic.id]);
  const lessonProgress = useQueryOnce<LessonProgressDoc>(() => (uid ? query(collection(db, "lessonProgress"), where("userId", "==", uid), where("topicId", "==", topic.id)) : null), [uid, topic.id]);
  const progressByLesson = new Map(lessonProgress.data.map((row) => [row.lessonId, row]));
  const setTab = (next: Tab) => setSearchParams((previous) => { previous.set("tab", next); return previous; }, { replace: true });
  const backTo = searchParams.get("from") === "jee" || searchParams.get("from") === "neet" ? `/${searchParams.get("from")}/${chapter.subjectId}/${chapter.id}` : learnPath(chapter);
  const aiPath = `${learnPath(chapter, topic)}?tab=orbitai`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={topic.name}
        subtitle={`Class ${chapter.classLevel} · ${SUBJECT_NAMES[chapter.subjectId]} · ${chapter.name}`}
        crumbs={[{ label: "Learn", to: "/learn" }, { label: chapter.name, to: backTo }]}
        action={mastery.data ? <span className="flex items-center gap-2 text-sm text-ink-500">Mastery {Math.round(mastery.data.mastery)} <StrengthTag strength={mastery.data.strength} /></span> : <Tag tone="neutral">Not rated yet</Tag>}
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {!topic.hasContent && <ContentPreparing what="this topic" />}

      {tab === "learn" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {topic.hasContent && (
              <section className="card">
                <h2 className="text-lg font-semibold">Concept</h2>
                <p className="mt-2 text-sm text-ink-700">{topic.concept}</p>
                {topic.keyPoints.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Important points</h3><ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{topic.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul></>}
                {topic.examples.length > 0 && (
                  <>
                    <h3 className="mt-4 text-sm font-semibold">Examples</h3>
                    <ol className="mt-1 space-y-2">{topic.examples.map((example) => <li key={example.problem} className="rounded-lg border border-ink-200 p-3 text-sm"><p className="font-medium">{example.problem}</p><p className="mt-1 text-ink-700">{example.solution}</p></li>)}</ol>
                  </>
                )}
                {topic.commonMistakes.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Common mistakes</h3><ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{topic.commonMistakes.map((item) => <li key={item}>{item}</li>)}</ul></>}
              </section>
            )}
            <AsyncState loading={lessons.loading || lessonProgress.loading} error={lessons.error ?? lessonProgress.error} empty={(lessons.data ?? []).length === 0} emptyTitle={topic.hasContent ? "No lesson yet" : "Lessons are being prepared"} emptyBody="Practice questions may still be available in the Practice tab.">
              {(lessons.data ?? []).map((lesson) => (
                <LessonView key={lesson.id} lesson={lesson} progress={progressByLesson.get(lesson.id) ?? null} onCompleted={(rewards) => { setToast(rewards); lessonProgress.reload(); }} />
              ))}
            </AsyncState>
          </div>
          <aside className="space-y-4">
            {topic.formulae.length > 0 && (
              <section className="card">
                <h2 className="text-lg font-semibold">Formulae</h2>
                <ul className="mt-2 space-y-1 font-mono text-sm">{topic.formulae.map((item) => <li key={item} className="rounded bg-brand-50 px-2 py-1">{item}</li>)}</ul>
              </section>
            )}
            <StudyTimer topicId={topic.id} kind="learning" onRecorded={(rewards) => setToast(rewards)} />
          </aside>
        </div>
      )}

      {tab === "practice" && <TopicPractice topic={topic} aiPath={aiPath} onAnswered={() => mastery.reload()} />}
      {tab === "orbitai" && uid && <OrbitAiPanel conversationId={conversationIdFor(uid, `topic-${topic.id}`)} context={{ topicId: topic.id, chapterId: chapter.id }} title={`OrbitAI · ${topic.name}`} />}
      {tab === "test" && (
        <section className="card">
          <h2 className="text-lg font-semibold">Quick test</h2>
          <p className="mt-1 text-sm text-ink-700">A short timed topic test with basic, intermediate and advanced questions. The result updates this topic's mastery and shows what to revise.</p>
          <Link to={`/assessments?kind=topic_test&scopeId=${topic.id}`} className="btn-primary mt-3">Start topic test</Link>
        </section>
      )}
      {tab === "progress" && <TopicProgress mastery={mastery.data} />}
      <RewardToast result={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function TopicPractice({ topic, aiPath, onAnswered }: { topic: TopicDoc; aiPath: string; onAnswered: () => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty | 0>(0);
  const questions = useContent(() => content.questions({ topicId: topic.id, max: 60 }), [topic.id]);
  const pool = useMemo(() => (questions.data ?? []).filter((question) => difficulty === 0 || question.difficulty === difficulty), [questions.data, difficulty]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [difficulty, topic.id]);
  const current: QuestionDoc | undefined = pool[index];
  const counts = { 1: 0, 2: 0, 3: 0 } as Record<Difficulty, number>;
  for (const question of questions.data ?? []) counts[question.difficulty] += 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-500">Difficulty:</span>
        {([0, 1, 2, 3] as (Difficulty | 0)[]).map((level) => (
          <button key={level} type="button" className={difficulty === level ? "btn-primary py-1" : "btn-secondary py-1"} onClick={() => setDifficulty(level)}>
            {level === 0 ? `All (${(questions.data ?? []).length})` : `${DIFFICULTY_LABELS[level]} (${counts[level]})`}
          </button>
        ))}
      </div>
      <AsyncState loading={questions.loading} error={questions.error} empty={pool.length === 0} emptyTitle="Content for this topic is being prepared." emptyBody="No questions exist at this difficulty yet.">
        {current && (
          <QuestionCard
            key={current.id}
            question={current}
            index={index}
            total={pool.length}
            context="topic"
            askAiPath={aiPath}
            onAnswered={onAnswered}
            onNext={index + 1 < pool.length ? () => setIndex(index + 1) : undefined}
            onTrySimilar={pool.length > 1 ? () => setIndex((index + 1) % pool.length) : undefined}
          />
        )}
        {current && index + 1 >= pool.length && <p className="text-sm text-ink-500">This is the last question in the set. Change difficulty or open the Quick Test.</p>}
      </AsyncState>
    </div>
  );
}

function TopicProgress({ mastery }: { mastery: TopicMasteryDoc | null }) {
  if (!mastery) return <div className="card text-sm text-ink-500">No attempts yet. Opening this topic does not change progress; answering questions does.</div>;
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Your progress in this topic</h2>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-ink-500">Mastery</dt><dd className="text-2xl font-bold">{Math.round(mastery.mastery)}</dd><dd><StrengthTag strength={mastery.strength} /></dd></div>
        <div><dt className="text-ink-500">Accuracy</dt><dd className="text-2xl font-bold">{mastery.accuracy}%</dd></div>
        <div><dt className="text-ink-500">Questions attempted</dt><dd className="text-2xl font-bold">{mastery.attempts}</dd></div>
        <div><dt className="text-ink-500">Correct answers</dt><dd className="text-2xl font-bold">{mastery.correct}</dd></div>
        <div><dt className="text-ink-500">Distinct questions</dt><dd className="text-2xl font-bold">{mastery.distinctQuestionIds.length}</dd></div>
        <div><dt className="text-ink-500">Time spent answering</dt><dd className="text-2xl font-bold">{formatDuration(mastery.timeSpentSec)}</dd></div>
      </dl>
      <p className="mt-4 text-xs text-ink-500">Mastery combines difficulty-weighted accuracy, assessment results, coverage, recency and repeated mistakes. The formula is documented in functions/src/lib/mastery.ts.</p>
    </section>
  );
}
