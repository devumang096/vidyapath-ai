import type { QuestionKeyDoc, QuestionType, SubmittedAnswer } from "../types.js";

export function parseNumeric(raw: string): number | null {
  const match = raw.trim().toLowerCase().replace(/,/g, "").match(/-?\d+(\.\d+)?(e-?\d+)?/);
  return match ? Number(match[0]) : null;
}

/** Validate the wire shape of an answer. Returns null when it cannot be graded. */
export function parseSubmittedAnswer(raw: unknown, type: QuestionType, optionCount: number): SubmittedAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (type === "numerical") {
    const value = (raw as { value?: unknown }).value;
    return typeof value === "string" && value.trim().length > 0 && value.length <= 40 ? { value: value.trim() } : null;
  }
  const indexes = (raw as { indexes?: unknown }).indexes;
  if (!Array.isArray(indexes) || indexes.length === 0 || indexes.length > optionCount) return null;
  if (!indexes.every((index) => Number.isInteger(index) && index >= 0 && index < optionCount)) return null;
  if (type !== "multi" && indexes.length !== 1) return null;
  return { indexes: [...new Set(indexes as number[])].sort((left, right) => left - right) };
}

/** Server-side grading against the private key. Numerical answers allow the key tolerance or 0.5 percent, whichever is larger. */
export function gradeAnswer(type: QuestionType, key: QuestionKeyDoc, answer: SubmittedAnswer): boolean {
  if (type === "numerical") {
    if (!("value" in answer) || key.numericAnswer === null) return false;
    const value = parseNumeric(answer.value);
    if (value === null) return false;
    const tolerance = Math.max(key.tolerance, Math.abs(key.numericAnswer) * 0.005);
    return Math.abs(value - key.numericAnswer) <= tolerance;
  }
  if (!("indexes" in answer)) return false;
  const expected = [...key.correctIndexes].sort((left, right) => left - right);
  return expected.length === answer.indexes.length && expected.every((index, position) => index === answer.indexes[position]);
}
