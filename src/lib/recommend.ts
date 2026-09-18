import type { ChapterDoc, ChapterProgressDoc, LessonProgressDoc, Strength, TopicDoc, TopicMasteryDoc } from "./types";
import { learnPath } from "./content";

export interface Recommendation {
  kind: "practice" | "revise" | "learn" | "assess";
  title: string;
  reason: string;
  link: string;
  topicId: string | null;
}

export const STRENGTH_ORDER: Strength[] = ["weak", "needs_practice", "good", "strong", "unrated"];

export function byStrength(rows: TopicMasteryDoc[]): Record<Strength, TopicMasteryDoc[]> {
  const groups: Record<Strength, TopicMasteryDoc[]> = { weak: [], needs_practice: [], good: [], strong: [], unrated: [] };
  for (const row of rows) groups[row.strength].push(row);
  for (const key of STRENGTH_ORDER) groups[key].sort((left, right) => left.mastery - right.mastery);
  return groups;
}

export function strengthTone(strength: Strength): "danger" | "warn" | "brand" | "success" | "neutral" {
  switch (strength) {
    case "weak":
      return "danger";
    case "needs_practice":
      return "warn";
    case "good":
      return "brand";
    case "strong":
      return "success";
    default:
      return "neutral";
  }
}

export interface ContinueTarget {
  topic: TopicDoc;
  chapter: ChapterDoc;
  progress: number;
}

/**
 * "Recommended next": deterministic and explained. Priority: weakest rated topic, then a topic
 * with a started but unfinished lesson, then the first topic with content the student has not
 * opened, then an assessment once anything has been practised.
 */
export function recommendNext(
  mastery: TopicMasteryDoc[],
  topics: TopicDoc[],
  chapters: ChapterDoc[],
  lessonProgress: LessonProgressDoc[]
): Recommendation | null {
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const rated = mastery.filter((row) => row.strength !== "unrated").sort((left, right) => left.mastery - right.mastery);
  const weakest = rated.find((row) => row.strength === "weak" || row.strength === "needs_practice");
  if (weakest) {
    const topic = topicById.get(weakest.topicId);
    const chapter = topic ? chapterById.get(topic.chapterId) : undefined;
    if (topic && chapter) {
      return {
        kind: "practice",
        title: `Practice ${topic.name}`,
        reason: `Mastery is ${Math.round(weakest.mastery)} after ${weakest.attempts} attempts (${weakest.accuracy}% accuracy). Ten more questions here move the needle most.`,
        link: `${learnPath(chapter, topic)}?tab=practice`,
        topicId: topic.id
      };
    }
  }
  const started = lessonProgress.find((row) => row.status === "started");
  if (started) {
    const topic = topicById.get(started.topicId);
    const chapter = topic ? chapterById.get(topic.chapterId) : undefined;
    if (topic && chapter) return { kind: "learn", title: `Finish ${topic.name}`, reason: "You started this lesson and have not completed it yet.", link: learnPath(chapter, topic), topicId: topic.id };
  }
  const touched = new Set([...mastery.map((row) => row.topicId), ...lessonProgress.map((row) => row.topicId)]);
  const fresh = topics.find((topic) => topic.hasContent && !touched.has(topic.id));
  if (fresh) {
    const chapter = chapterById.get(fresh.chapterId);
    if (chapter) return { kind: "learn", title: `Learn ${fresh.name}`, reason: `A new topic in ${chapter.name} with a full lesson and practice set.`, link: learnPath(chapter, fresh), topicId: fresh.id };
  }
  if (rated.length) return { kind: "assess", title: "Take today's assessment", reason: "You have practised enough for a mixed assessment to tell you where you stand.", link: "/assessments", topicId: null };
  return null;
}

/** Latest topic the student worked on that is not yet strong, with a rough completion percentage. */
export function continueLearning(
  mastery: TopicMasteryDoc[],
  lessonProgress: LessonProgressDoc[],
  topics: TopicDoc[],
  chapters: ChapterDoc[],
  chapterProgress: ChapterProgressDoc[]
): ContinueTarget | null {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const chapterDone = new Map(chapterProgress.map((row) => [row.chapterId, row]));
  const candidates = [
    ...mastery.filter((row) => row.strength !== "strong").map((row) => ({ topicId: row.topicId, at: toMillis(row.lastPracticedAt) })),
    ...lessonProgress.map((row) => ({ topicId: row.topicId, at: toMillis(row.completedAt ?? row.startedAt) }))
  ].sort((left, right) => right.at - left.at);
  for (const candidate of candidates) {
    const topic = topicById.get(candidate.topicId);
    const chapter = topic ? chapterById.get(topic.chapterId) : undefined;
    if (!topic || !chapter) continue;
    const progressDoc = chapterDone.get(chapter.id);
    const lessonPart = progressDoc && progressDoc.lessonsTotal > 0 ? progressDoc.lessonsCompleted / progressDoc.lessonsTotal : 0;
    const masteryPart = (mastery.find((row) => row.topicId === topic.id)?.mastery ?? 0) / 100;
    return { topic, chapter, progress: Math.round(((lessonPart + masteryPart) / 2) * 100) };
  }
  return null;
}

function toMillis(value: unknown): number {
  if (typeof value === "object" && value !== null && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return 0;
}
