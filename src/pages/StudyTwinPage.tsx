import { useMemo, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { content, SUBJECT_NAMES, useContent } from "../lib/content";
import { api, type QuizResults } from "../lib/callables";
import { timeAgo, toDate } from "../lib/format";
import { db } from "../lib/firebase";
import { useAction, useDoc, useQueryOnce } from "../hooks/useFirestore";
import { AsyncState, EmptyState, InlineError, PageHeader, ProgressBar, PrototypeTag, Tag } from "../components/ui";
import { GOAL_LABELS, LEVEL_NAMES, type PublicProfile, type StudyTwinPairDoc, type TwinChallengeDoc } from "../lib/types";

export default function StudyTwinPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const me = useDoc<PublicProfile>(uid ? `publicProfiles/${uid}` : null);
  const match = useAction(async () => {
    const result = await api.matchStudyTwin({});
    me.reload();
    return result;
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Study Twin" subtitle="A peer at your class, goal and level to compare progress with and challenge. No chat, no personal details." action={<PrototypeTag label="Prototype Feature: peer matching without chat" />} />
      <AsyncState loading={me.loading} error={me.error} onRetry={me.reload}>
        {!me.data ? (
          <EmptyState title="Profile not ready" body="Your anonymous profile is created a few seconds after registration. Refresh shortly." />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <ProfileCard title="You" profile={me.data} />
              <div className="card">
                <h2 className="font-semibold">What is shared</h2>
                <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">
                  <li>Anonymous username and avatar</li>
                  <li>Class, goal, learning level, subjects</li>
                  <li>Progress summary (questions solved, modules completed)</li>
                </ul>
                <h2 className="mt-3 font-semibold">Never shared</h2>
                <p className="mt-1 text-sm text-ink-700">Your name, email, phone number, address or any contact details.</p>
              </div>
            </div>
            {me.data.twinPairId ? (
              <PairView uid={uid} me={me.data} pairId={me.data.twinPairId} />
            ) : (
              <div className="card mt-4">
                {me.data.twinStatus === "searching" ? (
                  <p className="text-sm text-ink-700">Searching for a twin at Class {me.data.classLevel} with goal {GOAL_LABELS[me.data.goal]}. You will be matched as soon as a peer looks for one too.</p>
                ) : (
                  <p className="text-sm text-ink-700">Find a peer to keep each other consistent.</p>
                )}
                <button type="button" className="btn-primary mt-3" disabled={match.busy} onClick={() => void match.run()}>
                  {match.busy ? "Matching..." : me.data.twinStatus === "searching" ? "Check again" : "Find my Study Twin"}
                </button>
                <InlineError message={match.error} />
              </div>
            )}
          </>
        )}
      </AsyncState>
    </div>
  );
}

function ProfileCard({ title, profile }: { title: string; profile: PublicProfile }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-ink-500">{title}</p>
      <p className="mt-1 text-lg font-semibold">{profile.anonUsername}</p>
      <p className="text-xs text-ink-500">Avatar {profile.avatar} · Class {profile.classLevel} · {GOAL_LABELS[profile.goal]}</p>
      <p className="mt-2 text-sm">Level {profile.level}: {LEVEL_NAMES[profile.level]}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {profile.subjects.map((subject) => <Tag key={subject}>{SUBJECT_NAMES[subject]}</Tag>)}
      </div>
    </div>
  );
}

function PairView({ uid, me, pairId }: { uid: string; me: PublicProfile; pairId: string }) {
  const pair = useDoc<StudyTwinPairDoc>(`studyTwins/${pairId}`);
  const partnerUid = pair.data?.members.find((member) => member !== uid) ?? null;
  const partner = useDoc<PublicProfile>(partnerUid ? `publicProfiles/${partnerUid}` : null);
  const challenges = useQueryOnce<TwinChallengeDoc>(
    () => query(collection(db, "twinChallenges"), where("members", "array-contains", uid), where("pairId", "==", pairId), orderBy("createdAt", "desc"), limit(1)),
    [uid, pairId]
  );
  const latest = challenges.data[0] ?? null;
  const create = useAction(async () => {
    const result = await api.createTwinChallenge({ pairId });
    challenges.reload();
    return result;
  });

  const presence = useMemo(() => {
    const updated = toDate(partner.data?.updatedAt);
    if (!updated) return "unknown";
    return Date.now() - updated.getTime() < 7 * 86_400_000 ? "active this week" : "quiet";
  }, [partner.data?.updatedAt]);

  return (
    <AsyncState loading={pair.loading || partner.loading} error={pair.error ?? partner.error} onRetry={pair.reload}>
      {partner.data && (
        <section className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ProfileCard title="Your twin" profile={partner.data} />
            <div className="card">
              <h2 className="font-semibold">Study together status</h2>
              <p className="mt-1 text-sm text-ink-700">Twin is <strong>{presence}</strong> (based on last profile update). <PrototypeTag /></p>
              <h2 className="mt-4 font-semibold">Compare progress</h2>
              <div className="mt-2 space-y-3 text-sm">
                <CompareRow label="Questions solved" mine={me.progressSummary.questionsSolved} theirs={partner.data.progressSummary.questionsSolved} />
                <CompareRow label="Modules completed" mine={me.progressSummary.modulesCompleted} theirs={partner.data.progressSummary.modulesCompleted} />
                <CompareRow label="Learning level" mine={me.level} theirs={partner.data.level} max={5} />
              </div>
            </div>
          </div>
          <div className="card mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Twin challenge</h2>
              <button type="button" className="btn-primary" disabled={create.busy} onClick={() => void create.run()}>{create.busy ? "Creating..." : "Challenge my twin"}</button>
            </div>
            <InlineError message={create.error} />
            <AsyncState loading={challenges.loading} error={challenges.error} empty={!latest} emptyTitle="No challenge yet" emptyBody="Start a 5-question challenge; you both answer the same questions.">
              {latest && <TwinChallenge uid={uid} partnerUid={partnerUid ?? ""} challenge={latest} onSubmitted={challenges.reload} />}
            </AsyncState>
          </div>
        </section>
      )}
    </AsyncState>
  );
}

function CompareRow({ label, mine, theirs, max }: { label: string; mine: number; theirs: number; max?: number }) {
  const ceiling = max ?? Math.max(mine, theirs, 1);
  return (
    <div>
      <p className="mb-1 text-xs text-ink-500">{label}</p>
      <ProgressBar label={`You: ${mine}`} value={(mine / ceiling) * 100} />
      <div className="mt-1"><ProgressBar label={`Twin: ${theirs}`} value={(theirs / ceiling) * 100} tone="success" /></div>
    </div>
  );
}

function TwinChallenge({ uid, partnerUid, challenge, onSubmitted }: { uid: string; partnerUid: string; challenge: TwinChallengeDoc; onSubmitted: () => void }) {
  const questions = useContent(() => content.questions(challenge.questionIds), [challenge.id]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [results, setResults] = useState<QuizResults | null>(null);
  const mine = challenge.results[uid] ?? null;
  const theirs = challenge.results[partnerUid] ?? null;
  const submit = useAction(async () => {
    const result = await api.submitTwinChallenge({ challengeId: challenge.id, answers });
    if (result.results) setResults(result.results);
    onSubmitted();
    return result;
  });

  return (
    <div className="mt-3">
      <p className="text-xs text-ink-500">Started {timeAgo(challenge.createdAt)}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
        <p>You: {mine ? `${mine.score} / ${mine.total}` : "not submitted"}</p>
        <p>Twin: {theirs ? `${theirs.score} / ${theirs.total}` : "waiting"}</p>
      </div>
      {!mine && (
        <AsyncState loading={questions.loading} error={questions.error}>
          <ol className="mt-3 space-y-3">
            {(questions.data ?? []).map((question, index) => (
              <li key={question.id} className="rounded-lg border border-ink-200 p-3">
                <p className="font-medium">{index + 1}. {question.text}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {question.options.map((option, optionIndex) => (
                    <label key={optionIndex} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                      <input type="radio" name={`twin-${question.id}`} checked={answers[question.id] === optionIndex} disabled={Boolean(results)} onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: optionIndex }))} />
                      {option}
                    </label>
                  ))}
                </div>
                {results?.[question.id] && <p className={`mt-1 text-sm ${results[question.id].correct ? "text-success-500" : "text-danger-500"}`}>{results[question.id].explanation}</p>}
              </li>
            ))}
          </ol>
          {!results && <button type="button" className="btn-primary mt-3" disabled={submit.busy} onClick={() => void submit.run()}>{submit.busy ? "Submitting..." : "Submit answers"}</button>}
          <InlineError message={submit.error} />
        </AsyncState>
      )}
    </div>
  );
}
