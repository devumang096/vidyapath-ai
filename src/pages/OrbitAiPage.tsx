import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, useContent } from "../lib/content";
import { db } from "../lib/firebase";
import { newId, timeAgo } from "../lib/format";
import { useLiveQuery } from "../hooks/useFirestore";
import { AsyncState, PageHeader } from "../components/ui";
import { AI_MODE_LABELS, conversationIdFor, OrbitAiPanel } from "../components/OrbitAiPanel";
import type { AiConversationDoc, AiMode } from "../lib/types";

/** OrbitAI home: conversation list on the left, active conversation on the right, context taken from the URL when opened from a page. */
export default function OrbitAiPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "";
  const [params] = useSearchParams();
  const topicId = params.get("topicId");
  const chapterId = params.get("chapterId");
  const questionId = params.get("questionId");
  const initialMode = (Object.keys(AI_MODE_LABELS).includes(params.get("mode") ?? "") ? params.get("mode") : "explain") as AiMode;
  const scope = questionId ? `question-${questionId}` : topicId ? `topic-${topicId}` : chapterId ? `chapter-${chapterId}` : null;
  const [freshId, setFreshId] = useState(() => newId().slice(0, 12));
  const [selected, setSelected] = useState<string | null>(null);
  const conversationId = selected ?? (scope && uid ? conversationIdFor(uid, scope) : `${uid}_chat-${freshId}`);
  const conversations = useLiveQuery<AiConversationDoc>(() => (uid ? query(collection(db, "aiConversations"), where("userId", "==", uid), orderBy("updatedAt", "desc"), limit(20)) : null), [uid]);
  const active = useMemo(() => conversations.data.find((item) => item.id === conversationId) ?? null, [conversations.data, conversationId]);
  const context = { topicId: active?.topicId ?? topicId, chapterId: active?.chapterId ?? chapterId, questionId: active?.questionId ?? questionId };
  const contextLabel = useContent(async () => {
    if (context.topicId) return (await content.topic(context.topicId))?.name ?? null;
    if (context.chapterId) return (await content.chapter(context.chapterId))?.name ?? null;
    if (context.questionId) return "a question";
    return null;
  }, [context.topicId, context.chapterId, context.questionId]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="OrbitAI" subtitle={`Your tutor for Class ${profile?.classLevel ?? ""}. Explain, solve, hint, quiz, revise, analyse mistakes or plan your day.`} action={<button type="button" className="btn-secondary" onClick={() => { setSelected(null); setFreshId(newId().slice(0, 12)); }}>New conversation</button>} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="card lg:max-h-[70vh] lg:overflow-y-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Conversations</h2>
          <AsyncState loading={conversations.loading} error={conversations.error} empty={conversations.data.length === 0} emptyTitle="No conversations yet" emptyBody="Your chats are saved so you can pick them up later." skeletonLines={4}>
            <ul className="mt-2 space-y-1">
              {conversations.data.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`w-full rounded-lg px-3 py-2 text-left text-sm ${item.id === conversationId ? "bg-brand-50 text-brand-700" : "hover:bg-ink-100"}`} onClick={() => setSelected(item.id)}>
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block text-xs text-ink-500">{item.messageCount} messages · {timeAgo(item.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </AsyncState>
        </aside>
        <div>
          {contextLabel.data && <p className="mb-2 text-sm text-ink-500">Context: {contextLabel.data}</p>}
          {uid && <OrbitAiPanel key={conversationId} conversationId={conversationId} context={context} initialMode={initialMode} />}
          <p className="mt-3 text-xs text-ink-500">OrbitAI is a study helper, not a counsellor. If you are struggling with more than studies, talk to a trusted adult. In India, Tele-MANAS 14416 is free and available 24 hours.</p>
        </div>
      </div>
    </div>
  );
}
