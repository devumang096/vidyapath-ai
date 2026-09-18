import { useState, type FormEvent } from "react";
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth, demoMode } from "../lib/firebase";
import { Brand } from "../components/Brand";
import { InlineError } from "../components/ui";

const DEMO_LOGINS = [
  { label: "Student (Aarav, with history)", email: "aarav@eduorbit.demo" },
  { label: "Student (Priya, fresh)", email: "priya@eduorbit.demo" },
  { label: "Admin", email: "admin@eduorbit.demo" }
];

export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Wrong email or password. Please try again.";
    case "auth/user-not-found":
      return "No account exists for this email. Create one first.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes or reset your password.";
    case "auth/invalid-email":
      return "That email address does not look right.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was closed before finishing.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Log in instead.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 6 characters).";
    default:
      return "Could not sign in. Please try again.";
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      console.error("Login failed", caught);
      setError(authErrorMessage((caught as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      console.error("Google sign-in failed", caught);
      setError(authErrorMessage((caught as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md">
        <Brand />
        <h1 className="mt-4 text-2xl font-bold">Log in</h1>
        {demoMode && (
          <div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm text-ink-700">
            <p className="font-semibold text-brand-700">Demo mode</p>
            <p className="mt-1">Password for every demo account is <code>demo1234</code>. Data stays in this browser.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEMO_LOGINS.map((login) => (
                <button key={login.email} type="button" className="btn-secondary text-xs" onClick={() => { setEmail(login.email); setPassword("demo1234"); }}>{login.label}</button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => void withGoogle()} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.2-4.8 7.3l7.4 5.7c4.4-4.1 7.2-10.1 7.2-16.6z" /><path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.6l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" /></svg>
          Continue with Google
        </button>
        <div className="my-4 flex items-center gap-3 text-xs text-ink-500"><span className="h-px flex-1 bg-ink-200" />or<span className="h-px flex-1 bg-ink-200" /></div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="mt-3">
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <InlineError message={error} />
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>{busy ? "Signing in..." : "Log in"}</button>
        <div className="mt-4 flex justify-between text-sm">
          <Link to="/reset-password" className="text-brand-600">Forgot password?</Link>
          <Link to="/signup" className="text-brand-600">Create account</Link>
        </div>
      </form>
    </div>
  );
}
