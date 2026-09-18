import { useEffect, useState } from "react";
import { api, type OutcomeResult } from "../lib/callables";
import { useAction } from "../hooks/useFirestore";
import { InlineError, Tag } from "./ui";
import type { LessonDoc, LessonProgressDoc } from "../lib/types";

/** One lesson with its content blocks. Opening it marks it started; the student presses Complete to finish (never automatic). */
export function LessonView({ lesson, progress, onCompleted }: { lesson: LessonDoc; progress: LessonProgressDoc | null; onCompleted: (rewards: OutcomeResult | null, chapterCompleted: boolean) => void }) {
  const [status, setStatus] = useState<"started" | "completed" | null>(progress?.status ?? null);
  const complete = useAction(async () => api.completeLesson({ lessonId: lesson.id }));

  useEffect(() => {
    setStatus(progress?.status ?? null);
    if (progress) return;
    api.startLesson({ lessonId: lesson.id })
      .then((result) => setStatus(result.status))
      .catch((error) => console.error("Could not mark lesson started", error));
  }, [lesson.id, progress]);

  async function finish() {
    const result = await complete.run();
    if (result) {
      setStatus("completed");
      onCompleted(result.rewards, result.chapterCompleted);
    }
  }

  return (
    <article className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{lesson.title}</h3>
          <p className="text-sm text-ink-500">{lesson.description} · about {lesson.estimatedMinutes} min</p>
        </div>
        {status === "completed" ? <Tag tone="success">Completed</Tag> : status === "started" ? <Tag tone="brand">In progress</Tag> : null}
      </div>
      <div className="mt-4 space-y-4">
        {lesson.blocks.map((block, index) => (
          <section key={index} className={block.type === "formula" ? "rounded-xl bg-brand-50 p-4" : block.type === "example" ? "rounded-xl border border-ink-200 p-4" : ""}>
            <h4 className="text-sm font-semibold text-ink-900">{block.heading}</h4>
            {block.type === "keypoints" ? (
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{block.body.split("\n").map((line) => <li key={line}>{line}</li>)}</ul>
            ) : (
              <p className={`mt-1 whitespace-pre-line text-sm text-ink-700 ${block.type === "formula" ? "font-mono" : ""}`}>{block.body}</p>
            )}
          </section>
        ))}
      </div>
      <InlineError message={complete.error} />
      {status !== "completed" && (
        <button type="button" className="btn-primary mt-5" disabled={complete.busy} onClick={() => void finish()}>{complete.busy ? "Saving..." : "Mark lesson complete"}</button>
      )}
    </article>
  );
}
