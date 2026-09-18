import { useEffect, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { Brand } from "../components/Brand";
import { InlineError } from "../components/ui";
import { errorMessage } from "../lib/callables";
import { SUBJECT_NAMES, subjectsForGoal } from "../lib/subjects";
import { GOAL_LABELS, LEARNING_LEVEL_LABELS, type ClassLevel, type Goal, type Language, type LearningLevel, type SubjectId } from "../lib/types";

const STEPS = ["Class", "Learning path", "Subjects", "Daily goal", "Language and level"];
const GOAL_MINUTES = [30, 45, 60, 90, 120];

/** Five short steps, saved to users/{uid} in one update; the dashboard opens only once onboardingComplete is true. */
export default function OnboardingPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [classLevel, setClassLevel] = useState<ClassLevel>(profile?.classLevel ?? 10);
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? "school");
  const [subjects, setSubjects] = useState<SubjectId[]>(profile?.subjects ?? []);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(profile?.dailyGoalMinutes ?? 60);
  const [language, setLanguage] = useState<Language>(profile?.language ?? "en");
  const [learningLevel, setLearningLevel] = useState<LearningLevel>(profile?.learningLevel ?? "beginner");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allowed = subjectsForGoal(goal);
  useEffect(() => {
    setSubjects((previous) => {
      const kept = previous.filter((subject) => allowed.includes(subject));
      return kept.length ? kept : [...allowed];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal]);

  function toggleSubject(subject: SubjectId) {
    setSubjects((previous) => (previous.includes(subject) ? previous.filter((item) => item !== subject) : [...previous, subject]));
  }

  async function finish() {
    if (!user || busy) return;
    if (subjects.length === 0) {
      setError("Pick at least one subject.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, "users", user.uid), { classLevel, goal, subjects, dailyGoalMinutes, language, learningLevel, onboardingComplete: true, updatedAt: serverTimestamp() });
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      console.error("Onboarding save failed", caught);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const last = step === STEPS.length - 1;
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 p-4">
      <div className="card w-full max-w-xl">
        <Brand />
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-600">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        <div className="mt-2 h-1.5 w-full rounded-full bg-ink-200" aria-hidden="true"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

        {step === 0 && (
          <fieldset className="mt-5">
            <legend className="text-lg font-semibold">Which class are you in?</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([9, 10, 11, 12] as ClassLevel[]).map((level) => (
                <label key={level} className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-medium ${classLevel === level ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
                  <input type="radio" name="classLevel" className="sr-only" checked={classLevel === level} onChange={() => setClassLevel(level)} />
                  Class {level}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 1 && (
          <fieldset className="mt-5">
            <legend className="text-lg font-semibold">What are you preparing for?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.keys(GOAL_LABELS) as Goal[]).map((item) => (
                <label key={item} className={`cursor-pointer rounded-xl border p-3 text-sm font-medium ${goal === item ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
                  <input type="radio" name="goal" className="sr-only" checked={goal === item} onChange={() => setGoal(item)} />
                  {GOAL_LABELS[item]}
                  <span className="block text-xs font-normal text-ink-500">{subjectsForGoal(item).map((subject) => SUBJECT_NAMES[subject]).join(", ")}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 2 && (
          <fieldset className="mt-5">
            <legend className="text-lg font-semibold">Which subjects will you study?</legend>
            <p className="text-sm text-ink-500">Only subjects on your path are shown.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allowed.map((subject) => (
                <label key={subject} className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium ${subjects.includes(subject) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
                  <input type="checkbox" className="sr-only" checked={subjects.includes(subject)} onChange={() => toggleSubject(subject)} />
                  {SUBJECT_NAMES[subject]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 3 && (
          <fieldset className="mt-5">
            <legend className="text-lg font-semibold">How long do you want to study each day?</legend>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {GOAL_MINUTES.map((minutes) => (
                <label key={minutes} className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-medium ${dailyGoalMinutes === minutes ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200"}`}>
                  <input type="radio" name="minutes" className="sr-only" checked={dailyGoalMinutes === minutes} onChange={() => setDailyGoalMinutes(minutes)} />
                  {minutes} min
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 4 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="language" className="label">Preferred language</label>
              <select id="language" className="input" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
            <div>
              <label htmlFor="level" className="label">Learning level</label>
              <select id="level" className="input" value={learningLevel} onChange={(event) => setLearningLevel(event.target.value as LearningLevel)}>
                {(Object.keys(LEARNING_LEVEL_LABELS) as LearningLevel[]).map((level) => <option key={level} value={level}>{LEARNING_LEVEL_LABELS[level]}</option>)}
              </select>
            </div>
          </div>
        )}

        <InlineError message={error} />
        <div className="mt-6 flex justify-between">
          <button type="button" className="btn-secondary" disabled={step === 0 || busy} onClick={() => setStep((value) => value - 1)}>Back</button>
          {last ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void finish()}>{busy ? "Saving..." : "Go to my dashboard"}</button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setStep((value) => value + 1)} disabled={step === 2 && subjects.length === 0}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
