// Detects personal contact details in student-to-student text so they can be refused before they
// are stored. Students may be minors; EduOrbit never needs a phone number, email or handle to study.

const PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "a phone number", pattern: /(?:\+?\d[\s-]?){9,13}\d/ },
  { label: "an email address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/i },
  { label: "a social media handle", pattern: /(?:^|\s)@[a-z0-9_.]{3,}/i },
  { label: "a link", pattern: /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|in|org|net|io|me|link)\b/i },
  { label: "a messaging app contact", pattern: /\b(?:whatsapp|telegram|insta(?:gram)?|snap(?:chat)?|discord|signal)\b[\s:]*(?:me|id|number|no|handle)?\b/i }
];

/** Returns what was detected, or null when the text is clean. */
export function findContactSharing(text: string): string | null {
  for (const { label, pattern } of PATTERNS) if (pattern.test(text)) return label;
  return null;
}

export function contactSharingMessage(found: string): string {
  return `Your message looks like it contains ${found}. Keep phone numbers, emails, handles and links off EduOrbit; everything you need to study together is here.`;
}
