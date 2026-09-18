import { useState, type FormEvent } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, signInWithPopup } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { Brand } from "../components/Brand";
import { InlineError, Spinner } from "../components/ui";
import { subjectsForGoal } from "../lib/subjects";
import { DEFAULT_NOTIFICATION_PREFS, GOAL_LABELS, type ClassLevel, type Goal } from "../lib/types";
import { authErrorMessage } from "./LoginPage";

interface SignupValues {
  name: string;
  classLevel: ClassLevel;
  goal: Goal;
  phone: string;
  school: string;
}

const PHONE_PATTERN = /^\+?[0-9][0-9 -]{7,14}$/;

export function validateSignup(values: SignupValues): string | null {
  if (values.name.trim().length < 1 || values.name.trim().length > 60) return "Enter your full name (up to 60 characters).";
  if (values.phone.trim() && !PHONE_PATTERN.test(values.phone.trim())) return "Enter a valid phone number or leave it blank.";
  if (values.school.trim().length > 120) return "School name is too long.";
  return null;
}

/**
 * Creates the private user document. Rules pin the email to the token, force student role and
 * zero balances, and require onboarding fields; onboarding then updates the preference fields.
 */
export async function createProfile(uid: string, email: string, values: SignupValues, photoURL: string | null): Promise<void> {
  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    name: values.name.trim(),
    classLevel: values.classLevel,
    goal: values.goal,
    subjects: subjectsForGoal(values.goal),
    language: "en",
    learningLevel: "beginner",
    dailyGoalMinutes: 60,
    school: values.school.trim() || null,
    phone: values.phone.trim() || null,
    photoURL,
    onboardingComplete: false,
    notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    role: "student",
    xp: 0,
    coins: 0,
    questionsSolved: 0,
    lessonsCompleted: 0,
    chaptersCompleted: 0,
    assessmentsCompleted: 0,
    totalStudyMinutes: 0,
    activeDays: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [values, setValues] = useState<SignupValues>({ name: user?.displayName ?? "", classLevel: 10, goal: "school", phone: "", school: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const completingProfile = Boolean(user) && !profile;

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (user && profile) return <Navigate to={profile.onboardingComplete ? "/dashboard" : "/onboarding"} replace />;

  async function finish(uid: string, accountEmail: string, photoURL: string | null) {
    await createProfile(uid, accountEmail, values, photoURL);
    navigate("/onboarding", { replace: true });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validation = validateSignup(values);
    if (validation) {
      setError(validation);
      return;
    }
    if (!completingProfile && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (completingProfile && user) {
        await finish(user.uid, user.email ?? email.trim(), user.photoURL ?? null);
        return;
      }
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      try {
        await sendEmailVerification(credential.user);
      } catch (caught) {
        console.error("Verification email failed", caught);
      }
      await finish(credential.user.uid, credential.user.email ?? email.trim(), null);
    } catch (caught) {
      console.error("Signup failed", caught);
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
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      setValues((previous) => ({ ...previous, name: previous.name || credential.user.displayName || "" }));
    } catch (caught) {
      console.error("Google sign-up failed", caught);
      setError(authErrorMessage((caught as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-xl">
        <Brand />
        <h1 className="mt-4 text-2xl font-bold">{completingProfile ? "Complete your profile" : "Create your free account"}</h1>
        {(location.state as { completeProfile?: boolean } | null)?.completeProfile && (
          <p className="mt-1 text-sm text-ink-500">You are signed in as {user?.email}. Tell us a little about you to continue.</p>
        )}
        {!completingProfile && (
          <>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={() => void withGoogle()} disabled={busy}>Continue with Google</button>
            <div className="my-4 flex items-center gap-3 text-xs text-ink-500"><span className="h-px flex-1 bg-ink-200" />or sign up with email<span className="h-px flex-1 bg-ink-200" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div>
                <label htmlFor="password" className="label">Password</label>
                <input id="password" type="password" autoComplete="new-password" required minLength={6} className="input" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            </div>
          </>
        )}
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="name" className="label">Full name</label>
            <input id="name" className="input" maxLength={60} required value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="classLevel" className="label">Class</label>
              <select id="classLevel" className="input" value={values.classLevel} onChange={(event) => setValues({ ...values, classLevel: Number(event.target.value) as ClassLevel })}>
                {[9, 10, 11, 12].map((level) => <option key={level} value={level}>Class {level}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="goal" className="label">Learning goal</label>
              <select id="goal" className="input" value={values.goal} onChange={(event) => setValues({ ...values, goal: event.target.value as Goal })}>
                {(Object.keys(GOAL_LABELS) as Goal[]).map((goal) => <option key={goal} value={goal}>{GOAL_LABELS[goal]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="phone" className="label">Phone <span className="text-ink-500">(optional, never shown to other students)</span></label>
              <input id="phone" type="tel" autoComplete="tel" className="input" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} />
            </div>
            <div>
              <label htmlFor="school" className="label">School <span className="text-ink-500">(optional)</span></label>
              <input id="school" className="input" maxLength={120} value={values.school} onChange={(event) => setValues({ ...values, school: event.target.value })} />
            </div>
          </div>
        </div>
        <InlineError message={error} />
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>{busy ? "Creating..." : completingProfile ? "Continue" : "Create account"}</button>
        <p className="mt-3 text-center text-xs text-ink-500">By continuing you agree to the <Link to="/terms" className="text-brand-600">Terms</Link> and <Link to="/privacy" className="text-brand-600">Privacy Policy</Link>.</p>
        {!completingProfile && <p className="mt-3 text-center text-sm">Already registered? <Link to="/login" className="text-brand-600">Log in</Link></p>}
      </form>
    </div>
  );
}
