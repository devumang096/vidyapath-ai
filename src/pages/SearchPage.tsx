import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { content, learnPath, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { SUBJECT_IDS, SUBJECT_NAMES } from "../lib/subjects";
import { AI_MODE_LABELS } from "../components/OrbitAiPanel";
import { AsyncState, EmptyState, PageHeader, Tag } from "../components/ui";
import type { AiMode, GroupDoc } from "../lib/types";

interface SearchEntry {
  type: "Subject" | "Chapter" | "Topic" | "Lesson" | "Question" | "JEE" | "NEET" | "OrbitAI" | "Group";
  title: string;
  detail: string;
  link: string;
  haystack: string;
}

const PAGE_SIZE = 20;

/** Global search over a client-side content index plus a debounced Firestore prefix query for public groups. */
export default function SearchPage() {
  const [params] = useSearchParams();
  const queryText = (params.get("q") ?? "").trim().toLowerCase();
  const chapters = useContent(() => content.allChapters(), []);
  const topics = useContent(() => content.allTopics(), []);
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState<GroupDoc[]>([]);

  useEffect(() => {
    setPage(1);
    if (queryText.length < 2) {
      setGroups([]);
      return;
    }
    const handle = setTimeout(() => {
      getDocs(query(collection(db, "groups"), where("privacy", "==", "public"), where("nameLower", ">=", queryText), where("nameLower", "<=", `${queryText}`), orderBy("nameLower"), limit(10)))
        .then((snapshot) => setGroups(snapshot.docs.map((item) => item.data() as GroupDoc)))
        .catch((error) => console.error("Group search failed", error));
    }, 300);
    return () => clearTimeout(handle);
  }, [queryText]);

  const index = useMemo<SearchEntry[]>(() => {
    const entries: SearchEntry[] = SUBJECT_IDS.map((subject) => ({ type: "Subject", title: SUBJECT_NAMES[subject], detail: "Classes 9 to 12", link: `/learn/10/${subject}`, haystack: SUBJECT_NAMES[subject] }));
    const chapterById = new Map((chapters.data ?? []).map((chapter) => [chapter.id, chapter]));
    for (const chapter of chapters.data ?? []) {
      entries.push({ type: "Chapter", title: chapter.name, detail: `Class ${chapter.classLevel} · ${SUBJECT_NAMES[chapter.subjectId]}${chapter.hasContent ? "" : " · preparing"}`, link: learnPath(chapter), haystack: `${chapter.name} ${chapter.keyConcepts.join(" ")}` });
      for (const tag of chapter.examTags) if (tag !== "school" && chapter.classLevel >= 11) entries.push({ type: tag === "jee" ? "JEE" : "NEET", title: chapter.name, detail: `${tag.toUpperCase()} · ${SUBJECT_NAMES[chapter.subjectId]}`, link: `/${tag}/${chapter.subjectId}/${chapter.id}`, haystack: `${chapter.name} ${tag}` });
    }
    for (const topic of topics.data ?? []) {
      const chapter = chapterById.get(topic.chapterId);
      if (!chapter) continue;
      entries.push({ type: "Topic", title: topic.name, detail: `${chapter.name} · Class ${topic.classLevel}`, link: learnPath(chapter, topic), haystack: `${topic.name} ${topic.keyPoints.join(" ")} ${topic.formulae.join(" ")}` });
      if (topic.hasContent) entries.push({ type: "Lesson", title: `${topic.name} lesson`, detail: chapter.name, link: learnPath(chapter, topic), haystack: `${topic.name} ${topic.concept}` });
      if (topic.hasContent) entries.push({ type: "Question", title: `Practice ${topic.name}`, detail: `${chapter.name} question set`, link: `${learnPath(chapter, topic)}?tab=practice`, haystack: `${topic.name} questions practice ${topic.examples.map((example) => example.problem).join(" ")}` });
    }
    for (const mode of Object.keys(AI_MODE_LABELS) as AiMode[]) entries.push({ type: "OrbitAI", title: AI_MODE_LABELS[mode], detail: "Open OrbitAI in this mode", link: `/orbitai?mode=${mode}`, haystack: `${AI_MODE_LABELS[mode]} orbitai ai tutor` });
    return entries;
  }, [chapters.data, topics.data]);

  const matches = useMemo(() => {
    if (!queryText) return [];
    const local = index.filter((entry) => entry.haystack.toLowerCase().includes(queryText));
    const remote: SearchEntry[] = groups.map((group) => ({ type: "Group", title: group.name, detail: `${group.memberCount} members · ${group.focus}`, link: `/groups/${group.id}`, haystack: group.name }));
    return [...remote, ...local];
  }, [index, groups, queryText]);
  const visible = matches.slice(0, page * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Search" subtitle={queryText ? `Results for "${params.get("q")}"` : "Search subjects, chapters, topics, lessons, questions, JEE, NEET, OrbitAI modes and public groups."} />
      <AsyncState loading={chapters.loading || topics.loading} error={chapters.error ?? topics.error} loadingLabel="Building search index...">
        {!queryText ? (
          <EmptyState title="Type something to search" body="Try 'motion', 'quadratic' or 'organic'." />
        ) : matches.length === 0 ? (
          <EmptyState title="No matches" body="Try a shorter word or a different spelling." />
        ) : (
          <>
            <ul className="space-y-2">
              {visible.map((entry) => (
                <li key={`${entry.type}-${entry.link}-${entry.title}`}>
                  <Link to={entry.link} className="card flex items-center justify-between gap-3 py-3 hover:border-brand-500">
                    <span><span className="font-semibold">{entry.title}</span><span className="block text-xs text-ink-500">{entry.detail}</span></span>
                    <Tag tone={entry.type === "Group" ? "brand" : "neutral"}>{entry.type}</Tag>
                  </Link>
                </li>
              ))}
            </ul>
            {visible.length < matches.length && <button type="button" className="btn-secondary mt-4" onClick={() => setPage((value) => value + 1)}>Show more ({matches.length - visible.length} left)</button>}
          </>
        )}
      </AsyncState>
    </div>
  );
}
