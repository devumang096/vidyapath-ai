import { useEffect, useRef, useState, type FormEvent } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { api } from "../lib/callables";
import { newId } from "../lib/format";
import { useAction, useLiveQuery } from "../hooks/useFirestore";
import { AiLabel, InlineError } from "./ui";
import type { AiMessageDoc, AiMode } from "../lib/types";

export const AI_MODE_LABELS: Record<AiMode, string> = {
  explain: "Explain",
  solve: "Solve",
  hint: "Hint",
  quiz: "Quiz",
  revision: "Revision",
  mistake_analysis: "Mistake Analysis",
  study_planner: "Study Planner"
};

export interface AiContext {
  topicId?: string | null;
  chapterId?: string | null;
  questionId?: string | null;
  attemptAnswer?: string;
}

/**
 * Embedded OrbitAI chat. Messages are read live from aiMessages (server-written), the request goes
 * through the askAi callable, and the conversation id is stable per page context so follow-ups keep
 * their history. Beginner mode is a prompt toggle, not a separate mode.
 */
export function OrbitAiPanel({ conversationId, context, initialMode = "explain", title = "OrbitAI", compact = false }: { conversationId: string; context: AiContext; initialMode?: AiMode; title?: string; compact?: boolean }) {
  const [mode, setMode] = useState<AiMode>(initialMode);
  const [beginner, setBeginner] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = useLiveQuery<AiMessageDoc>(() => query(collection(db, "aiMessages"), where("conversationId", "==", conversationId), orderBy("createdAt", "asc")), [conversationId]);
  const ask = useAction(async (text: string) => api.askAi({ conversationId, mode, message: text, beginner, topicId: context.topicId ?? null, chapterId: context.chapterId ?? null, questionId: context.questionId ?? null, attemptAnswer: context.attemptAnswer }));

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.data.length]);

  async function send(text: string) {
    const result = await ask.run(text);
    if (result) {
      setNotice(result.notice);
      setRemaining(result.remaining);
      setMessage("");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ask.busy) return;
    void send(message.trim());
  }

  const hasContext = Boolean(context.topicId || context.chapterId || context.questionId);
  return (
    <section className={compact ? "" : "card"} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <label className="flex items-center gap-2 text-xs text-ink-700"><input type="checkbox" checked={beginner} onChange={(event) => setBeginner(event.target.checked)} /> Beginner mode</label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="OrbitAI mode">
        {(Object.keys(AI_MODE_LABELS) as AiMode[]).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={mode === item} className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === item ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}`} onClick={() => setMode(item)}>
            {AI_MODE_LABELS[item]}
          </button>
        ))}
      </div>
      {!hasContext && mode !== "study_planner" && <p className="mt-2 text-xs text-ink-500">Open OrbitAI from a chapter, topic or question to give it context, or just ask.</p>}
      <div className={`mt-3 space-y-2 overflow-y-auto rounded-xl bg-ink-100 p-3 ${compact ? "max-h-72" : "max-h-96"}`} aria-live="polite">
        {messages.data.length === 0 && !ask.busy && <p className="text-sm text-ink-500">Choose a mode and ask. OrbitAI knows your class, path and this page.</p>}
        {messages.data.map((item) => (
          <div key={item.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${item.role === "user" ? "ml-auto bg-brand-600 text-white" : "bg-white text-ink-900"}`}>
            {item.role === "assistant" && <div className="mb-1 flex items-center gap-2 text-xs"><AiLabel source={item.source} /><span className="text-ink-500">{AI_MODE_LABELS[item.mode] ?? item.mode}</span></div>}
            <p className="whitespace-pre-line">{item.text}</p>
          </div>
        ))}
        {ask.busy && <p className="text-sm text-ink-500">OrbitAI is thinking...</p>}
        <div ref={bottomRef} />
      </div>
      {notice && <p className="mt-2 text-xs text-warn-500" role="status">{notice}</p>}
      <InlineError message={ask.error} />
      {ask.error && <button type="button" className="btn-secondary mt-2" onClick={() => void send(message.trim())}>Retry</button>}
      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <label htmlFor={`ai-input-${conversationId}`} className="sr-only">Message OrbitAI</label>
        <input id={`ai-input-${conversationId}`} className="input" placeholder={mode === "study_planner" ? "Anything specific for today's plan? (optional)" : "Ask a question or leave blank to use the mode as is"} value={message} maxLength={1500} onChange={(event) => setMessage(event.target.value)} />
        <button type="submit" className="btn-primary" disabled={ask.busy}>Send</button>
      </form>
      {remaining !== null && <p className="mt-1 text-xs text-ink-500">{remaining} OrbitAI requests left today.</p>}
    </section>
  );
}

/** Stable conversation id per page context so returning to a topic continues the same thread. */
export function conversationIdFor(uid: string, scope: string): string {
  return `${uid}_${scope}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || newId();
}
