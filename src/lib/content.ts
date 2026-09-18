import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import { errorMessage } from "./callables";
import type { AssessmentDoc, BadgeDoc, ChapterDoc, ClassLevel, Difficulty, ExamTag, LessonDoc, QuestionDoc, QuestionType, RewardDoc, SubjectId, SubjectDoc, TopicDoc } from "./types";

// Content collections are static per deploy, so results are memoised for the session.
const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(
      key,
      load().catch((error) => {
        cache.delete(key);
        throw error;
      })
    );
  }
  return cache.get(key) as Promise<T>;
}

async function list<T>(path: string, ...constraints: QueryConstraint[]): Promise<T[]> {
  const snapshot = await getDocs(query(collection(db, path), ...constraints));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
}

async function one<T>(path: string, id: string): Promise<T | null> {
  const snapshot = await getDoc(doc(db, path, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null;
}

export interface QuestionFilter {
  classLevel?: ClassLevel | null;
  subjectId?: SubjectId | null;
  chapterId?: string | null;
  topicId?: string | null;
  difficulty?: Difficulty | null;
  type?: QuestionType | null;
  examTag?: ExamTag | null;
  max?: number;
}

/** Firestore needs an equality filter per field; we only ever combine equalities plus one limit, so no composite index surprises. */
export function questionConstraints(filter: QuestionFilter): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (filter.topicId) constraints.push(where("topicId", "==", filter.topicId));
  else if (filter.chapterId) constraints.push(where("chapterId", "==", filter.chapterId));
  else {
    if (filter.classLevel) constraints.push(where("classLevel", "==", filter.classLevel));
    if (filter.subjectId) constraints.push(where("subjectId", "==", filter.subjectId));
  }
  if (filter.difficulty) constraints.push(where("difficulty", "==", filter.difficulty));
  if (filter.type) constraints.push(where("type", "==", filter.type));
  if (filter.examTag) constraints.push(where("examTags", "array-contains", filter.examTag));
  constraints.push(limit(filter.max ?? 40));
  return constraints;
}

export const content = {
  subjects: () => cached("subjects", () => list<SubjectDoc>("subjects", orderBy("order"))),
  allChapters: () => cached("chapters:all", () => list<ChapterDoc>("chapters", orderBy("order"))),
  chapters: (classLevel: ClassLevel, subjectId: SubjectId) =>
    cached(`chapters:${classLevel}:${subjectId}`, () => list<ChapterDoc>("chapters", where("classLevel", "==", classLevel), where("subjectId", "==", subjectId), orderBy("order"))),
  chaptersForExam: (examTag: ExamTag, subjectId: SubjectId) =>
    cached(`chapters:${examTag}:${subjectId}`, async () => {
      const rows = await list<ChapterDoc>("chapters", where("subjectId", "==", subjectId), where("examTags", "array-contains", examTag));
      return rows.filter((chapter) => examTag === "school" || chapter.classLevel >= 11).sort((left, right) => left.classLevel - right.classLevel || left.order - right.order);
    }),
  chapter: (chapterId: string) => cached(`chapter:${chapterId}`, () => one<ChapterDoc>("chapters", chapterId)),
  chapterBySlug: async (classLevel: ClassLevel, subjectId: SubjectId, slug: string) => (await content.chapters(classLevel, subjectId)).find((chapter) => chapter.slug === slug) ?? null,
  allTopics: () => cached("topics:all", () => list<TopicDoc>("topics", orderBy("order"))),
  topics: (chapterId: string) => cached(`topics:${chapterId}`, () => list<TopicDoc>("topics", where("chapterId", "==", chapterId), orderBy("order"))),
  topic: (topicId: string) => cached(`topic:${topicId}`, () => one<TopicDoc>("topics", topicId)),
  topicBySlug: async (chapterId: string, slug: string) => (await content.topics(chapterId)).find((topic) => topic.slug === slug) ?? null,
  lessons: (topicId: string) => cached(`lessons:${topicId}`, () => list<LessonDoc>("lessons", where("topicId", "==", topicId), orderBy("order"))),
  lessonsForChapter: (chapterId: string) => cached(`lessons:chapter:${chapterId}`, () => list<LessonDoc>("lessons", where("chapterId", "==", chapterId), orderBy("order"))),
  lesson: (lessonId: string) => cached(`lesson:${lessonId}`, () => one<LessonDoc>("lessons", lessonId)),
  question: (questionId: string) => cached(`question:${questionId}`, () => one<QuestionDoc>("questions", questionId)),
  questions: (filter: QuestionFilter) => cached(`questions:${JSON.stringify(filter)}`, () => list<QuestionDoc>("questions", ...questionConstraints(filter))),
  questionsById: (ids: string[]) =>
    cached(`questions:ids:${ids.join(",")}`, async () => {
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += 10) chunks.push(ids.slice(index, index + 10));
      const results = await Promise.all(chunks.map((chunk) => list<QuestionDoc>("questions", where(documentId(), "in", chunk))));
      const byId = new Map(results.flat().map((question) => [question.id, question]));
      return ids.map((id) => byId.get(id)).filter((question): question is QuestionDoc => Boolean(question));
    }),
  assessments: () => cached("assessments", () => list<AssessmentDoc>("assessments", orderBy("order"))),
  rewards: () => cached("rewards", () => list<RewardDoc>("rewards", orderBy("order"))),
  badges: () => cached("badges", () => list<BadgeDoc>("badges")),
  /** Rewards change stock at runtime, so callers that show stock should bypass the cache. */
  rewardsLive: () => list<RewardDoc>("rewards", orderBy("order"))
};

export interface ContentState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useContent<T>(load: () => Promise<T>, deps: unknown[]): ContentState<T> {
  const [state, setState] = useState<ContentState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    load()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        console.error("Content load failed", error);
        if (!cancelled) setState({ data: null, loading: false, error: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function learnPath(chapter: Pick<ChapterDoc, "classLevel" | "subjectId" | "slug">, topic?: Pick<TopicDoc, "slug"> | null): string {
  const base = `/learn/${chapter.classLevel}/${chapter.subjectId}/${chapter.slug}`;
  return topic ? `${base}/${topic.slug}` : base;
}

export function examPath(examTag: ExamTag, subjectId?: SubjectId, chapter?: Pick<ChapterDoc, "id"> | null): string {
  const base = `/${examTag}`;
  if (!subjectId) return base;
  return chapter ? `${base}/${subjectId}/${chapter.id}` : `${base}/${subjectId}`;
}
