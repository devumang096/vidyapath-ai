import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../lib/firebase";
import { InlineError } from "../components/ui";

function loginErrorMessage(code: string | undefined): string {
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
      setError(loginErrorMessage((caught as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 p-6">
      <form onSubmit={onSubmit} className="card w-full max-w-md">
        <p className="text-lg font-bold text-brand-700">VidyaPath AI</p>
        <h1 className="mt-1 text-2xl font-bold">Log in</h1>
        <div className="mt-4">
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
          <Link to="/register" className="text-brand-600">Create account</Link>
        </div>
      </form>
    </div>
  );
}
