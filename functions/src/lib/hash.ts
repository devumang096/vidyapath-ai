import { createHash } from "node:crypto";

const ADJECTIVES = ["Quiet", "Bright", "Swift", "Calm", "Keen", "Bold", "Clever", "Steady", "Curious", "Focused"];
const NOUNS = ["Falcon", "Otter", "Comet", "Maple", "Lynx", "Ember", "Orbit", "Pixel", "Harbor", "Summit"];

/** Anonymous, stable display name derived from the uid. Never reveals the real name or email. */
export function anonUsername(uid: string): string {
  const digest = createHash("sha1").update(uid).digest();
  const adjective = ADJECTIVES[digest[0] % ADJECTIVES.length];
  const noun = NOUNS[digest[1] % NOUNS.length];
  const number = (digest[2] % 90) + 10;
  return `${adjective}${noun}${number}`;
}

export function avatarFor(uid: string): string {
  const digest = createHash("sha1").update(uid).digest();
  return `avatar-${(digest[3] % 8) + 1}`;
}

/** Group invite code such as EDU-7K4P9: five unambiguous characters. */
export function inviteCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) code += alphabet[Math.floor(random() * alphabet.length)];
  return `EDU-${code}`;
}
