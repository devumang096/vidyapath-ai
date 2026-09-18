import type { AiMode, ChapterDoc, QuestionDoc, QuestionKeyDoc, TopicDoc, TopicMasteryDoc } from "../types.js";

export interface FallbackContext {
  mode: AiMode;
  topic: TopicDoc | null;
  chapter: ChapterDoc | null;
  question: QuestionDoc | null;
  key: QuestionKeyDoc | null;
  weakTopics: Pick<TopicMasteryDoc, "topicId" | "mastery" | "strength">[];
  dailyGoalMinutes: number;
  /** How many times this topic has already been explained in the conversation. */
  explainCount: number;
  /** How many hints have already been given for this question in the conversation. */
  hintCount: number;
}

export const FALLBACK_NOTICE = "OrbitAI is offline right now. Showing the content-authored explanation instead.";

/** Study plan split used when the model cannot produce one. Percentages of the daily goal. */
export const PLAN_WEIGHTS = { learning: 30, practice: 35, revision: 15, assessment: 10, ai: 5, breaks: 5 } as const;

export function planMinutes(minutesPerDay: number): Record<keyof typeof PLAN_WEIGHTS, number> {
  const keys = Object.keys(PLAN_WEIGHTS) as (keyof typeof PLAN_WEIGHTS)[];
  const result = {} as Record<keyof typeof PLAN_WEIGHTS, number>;
  let assigned = 0;
  keys.forEach((key, index) => {
    result[key] = index === keys.length - 1 ? minutesPerDay - assigned : Math.round((minutesPerDay * PLAN_WEIGHTS[key]) / 100);
    assigned += result[key];
  });
  return result;
}

function explainVariant(topic: TopicDoc, count: number): string {
  const variants = [
    () => [topic.concept, topic.keyPoints.length ? `Key points:\n- ${topic.keyPoints.join("\n- ")}` : ""].filter(Boolean).join("\n\n"),
    () => (topic.examples[0] ? `Let us start from an example this time.\n\n${topic.examples[0].problem}\n\n${topic.examples[0].solution}\n\nThe idea behind it: ${topic.concept}` : topic.concept),
    () => (topic.formulae.length ? `Here is the same idea through its formulae:\n- ${topic.formulae.join("\n- ")}\n\nEach one is a different view of: ${topic.concept}` : topic.concept),
    () => (topic.commonMistakes.length ? `A different angle: what usually goes wrong.\n- ${topic.commonMistakes.join("\n- ")}\n\nKeeping these in mind, the concept is: ${topic.concept}` : topic.concept)
  ];
  return variants[count % variants.length]();
}

/**
 * Deterministic, content-authored guidance used when Gemini is not configured or fails.
 * It never invents an answer: everything comes from the seeded topic, chapter or question key.
 */
export function fallbackResponse(ctx: FallbackContext): string | null {
  const { mode, topic, chapter, question, key } = ctx;
  switch (mode) {
    case "explain":
      if (topic) return explainVariant(topic, ctx.explainCount);
      if (chapter?.overview) return [chapter.overview, chapter.keyConcepts.length ? `Key concepts:\n- ${chapter.keyConcepts.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
      return null;
    case "hint":
      if (question?.hints.length) {
        const index = Math.min(ctx.hintCount, question.hints.length - 1);
        return `Hint ${index + 1} of ${question.hints.length}: ${question.hints[index]}`;
      }
      if (topic?.examples[0]) return `Start from this worked example: ${topic.examples[0].problem}`;
      return null;
    case "solve":
      if (key) return key.explanation;
      if (topic?.examples.length) return topic.examples.map((example) => `${example.problem}\n${example.solution}`).join("\n\n");
      return null;
    case "quiz":
      if (topic?.revision) return `Quick check: ${topic.revision.miniQuestion.question}\n\nReply with your answer and I will check it against: ${topic.revision.miniQuestion.answer}`;
      if (topic?.examples.length) return `Try this:\n${topic.examples.map((example, index) => `${index + 1}. ${example.problem}`).join("\n")}`;
      return null;
    case "revision":
      if (topic?.revision) return `Concept: ${topic.revision.concept}\nFormula: ${topic.revision.formula}\nWatch out: ${topic.revision.commonMistake}\nQuick question: ${topic.revision.miniQuestion.question}`;
      if (topic) return [topic.concept, topic.formulae.length ? `Formulae:\n- ${topic.formulae.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
      if (chapter?.formulas.length) return `Formulas to revise:\n- ${chapter.formulas.join("\n- ")}`;
      return null;
    case "mistake_analysis":
      if (key && question) return `Correct approach:\n${key.explanation}\n\nCommon slips in this topic:\n- ${(topic?.commonMistakes ?? []).join("\n- ") || "none recorded yet"}`;
      if (topic?.commonMistakes.length) return `Common mistakes in ${topic.name}:\n- ${topic.commonMistakes.join("\n- ")}`;
      return null;
    case "study_planner": {
      const plan = planMinutes(ctx.dailyGoalMinutes);
      const focus = ctx.weakTopics.length ? `Focus topics (weakest first): ${ctx.weakTopics.map((item) => item.topicId).join(", ")}.` : "No weak topics detected yet, so split time evenly across your subjects.";
      return `Daily plan for ${ctx.dailyGoalMinutes} minutes:\n- Learn: ${plan.learning} min\n- Practice: ${plan.practice} min\n- Revision: ${plan.revision} min\n- Assessment: ${plan.assessment} min\n- Ask OrbitAI: ${plan.ai} min\n- Breaks: ${plan.breaks} min\n\n${focus}`;
    }
  }
}
