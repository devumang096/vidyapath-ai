// firebase/auth stand-in for --mode demo builds. Accounts live in the demo store; the signed-in uid is kept in localStorage.
import "./init";
import { DemoError, listDocs, newDocId, readDoc, removeDoc, writeDoc } from "./store";

export interface DemoUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  emailVerified: boolean;
  providerData: { providerId: string }[];
  getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>;
  reload: () => Promise<void>;
}
interface AccountDoc {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  photoURL: string | null;
  admin: boolean;
  emailVerified: boolean;
  provider: "password" | "google.com";
}

const SESSION_KEY = "eduorbit.demo.uid";
const GOOGLE_DEMO_UID = "demo-google";
const listeners = new Set<(user: DemoUser | null) => void>();
let currentUser: DemoUser | null = null;

function toUser(account: AccountDoc): DemoUser {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    photoURL: account.photoURL,
    emailVerified: account.emailVerified,
    providerData: [{ providerId: account.provider }],
    getIdTokenResult: async () => ({ claims: account.admin ? { admin: true } : {} }),
    reload: async () => undefined
  };
}

function accountByEmail(email: string): AccountDoc | null {
  const wanted = email.trim().toLowerCase();
  return listDocs("demoAccounts").map((row) => row.data as unknown as AccountDoc).find((account) => account.email.toLowerCase() === wanted) ?? null;
}

function rememberUid(uid: string | null): void {
  try {
    if (uid) localStorage.setItem(SESSION_KEY, uid);
    else localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn("Could not remember demo session", error);
  }
}

function setCurrent(user: DemoUser | null): void {
  currentUser = user;
  rememberUid(user?.uid ?? null);
  for (const listener of listeners) listener(user);
}

function restoreSession(): void {
  try {
    const uid = typeof localStorage === "undefined" ? null : localStorage.getItem(SESSION_KEY);
    const account = uid ? (readDoc(`demoAccounts/${uid}`) as AccountDoc | null) : null;
    currentUser = account ? toUser(account) : null;
  } catch (error) {
    console.warn("Could not restore demo session", error);
  }
}
restoreSession();

function requireCurrentAccount(): AccountDoc {
  const account = currentUser ? (readDoc(`demoAccounts/${currentUser.uid}`) as AccountDoc | null) : null;
  if (!account) throw new DemoError("auth/requires-recent-login", "Please sign in again.");
  return account;
}

export function currentUid(): string | null {
  return currentUser?.uid ?? null;
}

export function getAuth(): { currentUser: DemoUser | null } {
  return { currentUser };
}
export function connectAuthEmulator(): void {}

export function onAuthStateChanged(_auth: unknown, listener: (user: DemoUser | null) => void): () => void {
  listeners.add(listener);
  queueMicrotask(() => listener(currentUser));
  return () => listeners.delete(listener);
}

export async function signInWithEmailAndPassword(_auth: unknown, email: string, password: string): Promise<{ user: DemoUser }> {
  const account = accountByEmail(email);
  if (!account) throw new DemoError("auth/user-not-found", "No account exists for this email.");
  if (account.password !== password) throw new DemoError("auth/invalid-credential", "Wrong email or password.");
  const user = toUser(account);
  setCurrent(user);
  return { user };
}

export async function createUserWithEmailAndPassword(_auth: unknown, email: string, password: string): Promise<{ user: DemoUser }> {
  if (!email.includes("@")) throw new DemoError("auth/invalid-email", "That email address does not look right.");
  if (password.length < 6) throw new DemoError("auth/weak-password", "Choose a stronger password.");
  if (accountByEmail(email)) throw new DemoError("auth/email-already-in-use", "An account with this email already exists.");
  const account: AccountDoc = { uid: `demo_${newDocId()}`, email: email.trim(), password, displayName: "", photoURL: null, admin: false, emailVerified: false, provider: "password" };
  writeDoc(`demoAccounts/${account.uid}`, { ...account });
  const user = toUser(account);
  setCurrent(user);
  return { user };
}

export class GoogleAuthProvider {
  static PROVIDER_ID = "google.com";
}

/** Demo Google sign-in: signs into a fixed Google-style account so the complete-profile flow can be exercised. */
export async function signInWithPopup(_auth: unknown, _provider: unknown): Promise<{ user: DemoUser }> {
  let account = readDoc(`demoAccounts/${GOOGLE_DEMO_UID}`) as AccountDoc | null;
  if (!account) {
    account = { uid: GOOGLE_DEMO_UID, email: "google.student@eduorbit.demo", password: "", displayName: "Demo Google Student", photoURL: null, admin: false, emailVerified: true, provider: "google.com" };
    writeDoc(`demoAccounts/${GOOGLE_DEMO_UID}`, { ...account });
  }
  const user = toUser(account);
  setCurrent(user);
  return { user };
}

export async function signOut(): Promise<void> {
  setCurrent(null);
}

export async function sendPasswordResetEmail(_auth: unknown, email: string): Promise<void> {
  if (!accountByEmail(email)) throw new DemoError("auth/user-not-found", "No account exists for this email.");
}

/** Demo: verification is instant because no email can be sent from the browser. */
export async function sendEmailVerification(user: DemoUser): Promise<void> {
  writeDoc(`demoAccounts/${user.uid}`, { emailVerified: true }, true);
  const account = readDoc(`demoAccounts/${user.uid}`) as AccountDoc | null;
  if (account) setCurrent(toUser(account));
}

export class EmailAuthProvider {
  static credential(email: string, password: string): { email: string; password: string } {
    return { email, password };
  }
}

export async function reauthenticateWithCredential(user: DemoUser, credential: { email: string; password: string }): Promise<void> {
  const account = readDoc(`demoAccounts/${user.uid}`) as AccountDoc | null;
  if (!account || account.password !== credential.password) throw new DemoError("auth/wrong-password", "Current password is wrong.");
}

export async function updatePassword(user: DemoUser, password: string): Promise<void> {
  if (password.length < 6) throw new DemoError("auth/weak-password", "Choose a stronger password.");
  writeDoc(`demoAccounts/${user.uid}`, { password }, true);
}

export async function updateProfile(user: DemoUser, patch: { displayName?: string; photoURL?: string | null }): Promise<void> {
  writeDoc(`demoAccounts/${user.uid}`, { ...patch }, true);
  const account = readDoc(`demoAccounts/${user.uid}`) as AccountDoc | null;
  if (account) setCurrent(toUser(account));
}

export async function deleteUser(user: DemoUser): Promise<void> {
  requireCurrentAccount();
  removeDoc(`demoAccounts/${user.uid}`);
  setCurrent(null);
}
