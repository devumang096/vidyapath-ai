const MAX_CHARS = 4000;
const MIN_CHARS = 8;

const BLOCKED_PATTERNS = [/\bapi[_ -]?key\b/i, /\bsk-[a-z0-9]{10,}/i, /<script/i, /javascript:/i];

const CRISIS_PATTERNS = [
  /\b(kill|hurt|harm|cut) (myself|me)\b/i,
  /\bsuicid/i,
  /\bend (my|it all|everything)\b/i,
  /\bwant to die\b/i,
  /\bself[- ]harm/i,
  /\bno reason to live\b/i
];

export const SUPPORT_NOTICE =
  "It sounds like you are going through something heavy. OrbitAI is a study helper, not a counsellor, so please talk to a trusted adult, a parent, a teacher or a school counsellor today. " +
  "If you are in immediate danger, contact your local emergency number. In India you can call Tele-MANAS at 14416 or KIRAN at 1800-599-0019, both free and available 24 hours.";

export interface ValidationResult {
  ok: boolean;
  text: string;
  reason: "empty" | "too_short" | "unsafe" | null;
}

/** Trim, cap length, and reject empty or unsafe model output before it reaches a student. */
export function validateAiText(raw: unknown): ValidationResult {
  if (typeof raw !== "string") return { ok: false, text: "", reason: "empty" };
  let text = raw.replace(/\r/g, "").trim();
  if (text.length === 0) return { ok: false, text: "", reason: "empty" };
  if (text.length < MIN_CHARS) return { ok: false, text, reason: "too_short" };
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) return { ok: false, text: "", reason: "unsafe" };
  if (text.length > MAX_CHARS) {
    const cut = text.lastIndexOf("\n", MAX_CHARS);
    text = `${text.slice(0, cut > MAX_CHARS / 2 ? cut : MAX_CHARS).trimEnd()}\n\n[Response shortened]`;
  }
  return { ok: true, text, reason: null };
}

/** Student messages that signal a safety situation get the support notice ahead of any tutoring. */
export function needsSupportNotice(studentMessage: string): boolean {
  return CRISIS_PATTERNS.some((pattern) => pattern.test(studentMessage));
}

/** Hint mode must not hand over the final answer. */
export function leaksFinalAnswer(text: string, acceptedAnswers: string[]): boolean {
  const lowered = text.toLowerCase();
  return acceptedAnswers.some((answer) => {
    const needle = answer.trim().toLowerCase();
    return needle.length > 0 && lowered.includes(needle);
  });
}
