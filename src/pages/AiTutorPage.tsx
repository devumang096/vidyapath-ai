import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { api } from "../lib/callables";
import { content, SUBJECT_NAMES, useContent } from "../lib/content";
import { newId } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useAction, useLiveQuery } from "../hooks/useFirestore";
import { AiLabel, InlineError, PageHeader, Spinner } from "../components/ui";
import type { AiMessageDoc, AiMode, ClassLevel, SubjectId } from "../lib/types";

const MODES: { mode: AiMode; label: string; placeholder: string }[] = [
  { mode: "explain", label: "Explain Concept", placeholder: "Which concept should Vidya explain?" },
  { mode: "solve_with_me", label: "Solve With Me", placeholder: "Paste the problem you want to solve together" },
  { mode: "hint", label: "Give Hint", placeholder: "Describe where you are stuck" },
  { mode: "generate_questions", label: "Generate Questions", placeholder: "Optional: any focus, e.g. word problems" },
  { mode: "check_answer", label: "Check My Answer", placeholder: "Paste the question" },
  { mode: "find_mistake", label: "Find My Mistake", placeholder: "Paste the question and your working" },
  { mode: "revision", label: "Revision", placeholder: "Optional: what to focus the revision sheet on" },
  { mode: "exam", label: "Exam Mode", placeholder: "Your reply to the examiner, or leave empty to start" }
];
const SESSION_KEY = "vidyapath.aiTutorSession";

function loadSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = newId();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch (error) {
    console.warn("sessionStorage unavailable, using a fresh AI session", error);
    return newId();
  }
}

export default function AiTutorPage() {
  const { user, profile } = useAuth();
  const [params] = useSearchParams();
  const presetTopicId = params.get("topic");
  const classLevel = (profile?.classLevel ?? 10) as ClassLevel;
  const sessionIdRef = useRef(loadSessionId());

  const [mode, setMode] = useState<AiMode>("explain");
  const [subjectId, setSubjectId] = useState<SubjectId | "">("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [message, setMessage] = useState("");
  const [attemptAnswer, setAttemptAnswer] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const presetTopic = useContent(() => (presetTopicId ? content.topic(presetTopicId) : Promise.resolve(null)), [presetTopicId]);
  useEffect(() => {
    if (presetTopic.data) {
      setSubjectId(presetTopic.data.subjectId);
      setChapterId(presetTopic.data.chapterId);
      setTopicId(presetTopic.data.id);
    }
  }, [presetTopic.data]);

  const subjects = useContent(() => content.subjects(), []);
  const chapters = useContent(() => (subjectId ? content.chapters(classLevel, subjectId) : Promise.resolve([])), [subjectId, classLevel]);
  const topics = useContent(() => (chapterId ? content.topics(chapterId) : Promise.resolve([])), [chapterId]);
  const subjectOptions = useMemo(() => (subjects.data ?? []).filter((subject) => subject.classLevels.includes(classLevel)), [subjects.data, classLevel]);

  const history = useLiveQuery<AiMessageDoc>(
    () => (user ? query(collection(db, `aiSessions/${user.uid}/messages`), where("sessionId", "==", sessionIdRef.current), orderBy("createdAt", "asc"), limit(20)) : null),
    [user?.uid]
  );

  const ask = useAction(api.askAi);
  const needsAnswer = mode === "check_answer" || mode === "find_mistake";
  const currentMode = MODES.find((entry) => entry.mode === mode) ?? MODES[0];

  const send = async () => {
    const response = await ask.run({
      sessionId: sessionIdRef.current,
      mode,
      message: message.trim(),
      topicId: topicId || null,
      attemptAnswer: needsAnswer ? attemptAnswer.trim() : ""
    });
    if (!response) return;
    setNotice(response.notice);
    setRemaining(response.remaining);
    setMessage("");
  };

  const listEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [history.data.length, ask.busy]);

  return (
    <div>
      <PageHeader title="Vidya AI Tutor" subtitle="Pick a mode, set the topic so Vidya knows your context, and ask. Every response is labelled as AI-generated." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="card space-y-3">
          <div role="tablist" aria-label="Tutor modes" className="flex flex-wrap gap-1">
            {MODES.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                role="tab"
                aria-selected={entry.mode === mode}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${entry.mode === mode ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`}
                onClick={() => setMode(entry.mode)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="tutor-subject" className="label">Subject</label>
            <select id="tutor-subject" className="input" value={subjectId} onChange={(event) => { setSubjectId(event.target.value as SubjectId | ""); setChapterId(""); setTopicId(""); }}>
              <option value="">Any subject</option>
              {subjectOptions.map((subject) => (
                <option key={subject.id} value={subject.id}>{SUBJECT_NAMES[subject.id] ?? subject.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tutor-chapter" className="label">Chapter</label>
            <select id="tutor-chapter" className="input" value={chapterId} disabled={!subjectId || chapters.loading} onChange={(event) => { setChapterId(event.target.value); setTopicId(""); }}>
              <option value="">Any chapter</option>
              {(chapters.data ?? []).filter((chapter) => !chapter.sampleOnly).map((chapter) => (
                <option key={chapter.id} value={chapter.id}>{chapter.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tutor-topic" className="label">Topic</label>
            <select id="tutor-topic" className="input" value={topicId} disabled={!chapterId || topics.loading} onChange={(event) => setTopicId(event.target.value)}>
              <option value="">Any topic</option>
              {(topics.data ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>{topic.name}</option>
              ))}
            </select>
          </div>
          {needsAnswer && (
            <div>
              <label htmlFor="tutor-answer" className="label">Your answer</label>
              <input id="tutor-answer" className="input" value={attemptAnswer} onChange={(event) => setAttemptAnswer(event.target.value)} placeholder="What did you get?" />
            </div>
          )}
          <div>
            <label htmlFor="tutor-message" className="label">{currentMode.label}</label>
            <textarea id="tutor-message" className="input min-h-28" placeholder={currentMode.placeholder} value={message} onChange={(event) => setMessage(event.target.value)} />
          </div>
          <button type="button" className="btn-primary w-full" disabled={ask.busy || (needsAnswer && !attemptAnswer.trim())} onClick={send}>
            {ask.busy ? "Asking Vidya..." : "Ask Vidya"}
          </button>
          <InlineError message={ask.error} />
          {remaining !== null && <p className="text-xs text-ink-500">{remaining} AI requests left today.</p>}
          <p className="text-xs text-ink-500">Vidya can make mistakes. Check important steps against your NCERT textbook.</p>
        </section>

        <section className="card">
          {notice && <p className="mb-3 rounded-lg bg-warn-500/10 p-2 text-xs text-warn-500" role="status">{notice}</p>}
          {history.error && <p className="text-sm text-danger-500" role="alert">{history.error}</p>}
          {history.loading && <Spinner label="Loading conversation..." />}
          {!history.loading && history.data.length === 0 && !ask.busy && (
            <p className="text-sm text-ink-500">No messages yet. Choose a mode and ask your first question.</p>
          )}
          <div className="max-h-[32rem] space-y-3 overflow-y-auto" aria-live="polite">
            {history.data.map((entry) => (
              <div key={entry.id} className={`rounded-lg p-3 text-sm ${entry.role === "user" ? "bg-brand-50 text-brand-700" : "bg-ink-100"}`}>
                {entry.role === "assistant" && (
                  <div className="mb-1">
                    <AiLabel source={entry.source} />
                  </div>
                )}
                <p className="whitespace-pre-line">{entry.text}</p>
              </div>
            ))}
            {ask.busy && <Spinner label="Vidya is thinking..." />}
            <div ref={listEndRef} />
          </div>
        </section>
      </div>
    </div>
  );
}
