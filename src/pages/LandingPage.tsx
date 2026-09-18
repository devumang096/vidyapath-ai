import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HeroVisual } from "../components/HeroVisual";
import { SUBJECT_NAMES, SUBJECTS_BY_PATH } from "../lib/subjects";

const TRUST = ["Classes 9 to 12", "JEE", "NEET", "OrbitAI", "Buddy Learning", "Group Learning", "Personalized Progress"];

const WHY = [
  { title: "Learn", body: "NCERT-aligned chapters and topics for Physics, Chemistry, Mathematics and Biology, with lessons, formulas, examples and common mistakes.", to: "/learn" },
  { title: "Practice", body: "MCQ, multiple answer, true or false, numerical and conceptual questions at three difficulties, graded on the server with explanations.", to: "/practice" },
  { title: "Ask OrbitAI", body: "Explain, solve, hint, quiz, revise, analyse mistakes or plan your day. OrbitAI knows which class, chapter and topic you are on.", to: "/orbitai" },
  { title: "Know Your Strengths", body: "Every answer and assessment feeds a mastery score per topic. Strong, Good, Needs Practice and Weak come from real performance.", to: "/progress" },
  { title: "Study Together", body: "Pair up with a Buddy in a shared study room or join a study group with discussions, sessions and challenges.", to: "/buddy" },
  { title: "Stay Motivated", body: "Streaks that need real learning, XP, Orbit Coins, badges, a daily spin and an Orbit Store of real goodies.", to: "/rewards" }
];

const AI_PROMPTS = ["Explain this concept", "Solve this question", "Give me a hint", "Test me", "Revise this chapter", "Analyze my mistakes", "Create a study plan"];
const JOURNEY = ["Learn", "Practice", "Assess", "Analyze", "Improve", "Master"];

export default function LandingPage() {
  const { user, profile } = useAuth();
  const startTo = user && profile ? "/dashboard" : "/login";
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[45fr_55fr] lg:py-20">
        <div>
          <h1 className="text-4xl font-bold leading-tight text-ink-900 sm:text-5xl">Quality Education. Without Barriers.</h1>
          <p className="mt-3 text-xl font-semibold text-brand-700">Learn. Practice. Ask. Improve. Grow.</p>
          <p className="mt-4 text-lg text-ink-700">
            EduOrbit is a free learning platform for students from Classes 9 to 12, JEE and NEET aspirants. Learn from structured content, practice questions, identify your strengths and weaknesses, ask OrbitAI anything, study with a Buddy or group, and track your entire learning journey.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={startTo} className="btn-primary px-6 py-3 text-base">Start Learning Free</Link>
            <a href="#why" className="btn-secondary px-6 py-3 text-base">Explore EduOrbit</a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="What EduOrbit covers">
            {TRUST.map((item) => <li key={item} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-700">{item}</li>)}
          </ul>
        </div>
        <div className="decorative"><HeroVisual /></div>
      </section>

      <section id="why" className="bg-ink-100 py-14" aria-labelledby="why-heading">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="why-heading" className="text-center text-3xl font-bold">Why EduOrbit?</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.map((card) => (
              <Link key={card.title} to={card.to} className="card block hover:border-brand-500">
                <h3 className="text-lg font-semibold text-brand-700">{card.title}</h3>
                <p className="mt-2 text-sm text-ink-700">{card.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="paths-heading">
        <h2 id="paths-heading" className="text-center text-3xl font-bold">One Platform, Multiple Learning Paths</h2>
        <p className="mt-2 text-center text-ink-500">Four subjects. Three paths. One connected record of your progress.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <PathCard title="School" subtitle="Classes 9 to 12" subjects={SUBJECTS_BY_PATH.school} to="/learn" />
          <PathCard title="JEE" subtitle="JEE Main and Advanced" subjects={SUBJECTS_BY_PATH.jee} to="/jee" />
          <PathCard title="NEET" subtitle="NCERT-focused" subjects={SUBJECTS_BY_PATH.neet} to="/neet" />
        </div>
      </section>

      <section className="bg-ink-900 py-14 text-white" aria-labelledby="ai-heading">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="ai-heading" className="text-3xl font-bold">Ask OrbitAI</h2>
            <p className="mt-3 text-ink-200">OrbitAI is the tutor inside every topic, question and assessment. It reads your class, path, chapter and recent mistakes, and every request goes through a secure backend so no key ever reaches the browser.</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {AI_PROMPTS.map((prompt) => <li key={prompt} className="rounded-full border border-white/20 px-3 py-1 text-sm">{prompt}</li>)}
            </ul>
            <Link to={user && profile ? "/orbitai" : "/login"} className="btn-primary mt-6 bg-white text-ink-900 hover:bg-brand-50">Ask OrbitAI</Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-ink-200">Class 10 · Physics · Motion · Hint mode</p>
            <div className="mt-3 rounded-xl bg-white/10 p-3"><span className="font-semibold">You:</span> A train slows from 30 m/s to rest in 15 s. What is its acceleration?</div>
            <div className="mt-2 rounded-xl bg-brand-600 p-3"><span className="font-semibold">OrbitAI:</span> You know u, v and t. Which of the three equations of motion has exactly those three and a? Write it down and tell me what you get for a before we check the sign.</div>
            <p className="mt-3 text-xs text-ink-200">Hint mode never reveals the answer first. Switch to Solve for the full working, or Quiz to be tested.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="personal-heading">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="personal-heading" className="text-3xl font-bold">Personalized to how you actually perform</h2>
            <p className="mt-3 text-ink-700">EduOrbit never guesses. Each topic gets a mastery score from your accuracy, question difficulty, assessments, recency and repeated mistakes. Opening a page changes nothing; answering does.</p>
            <p className="mt-3 text-ink-700">Recommendations start from your weakest rated topic and tell you why.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Strong Topics", "Mastery 75 and above", "bg-success-500/15 text-success-500"],
              ["Good Topics", "Mastery 55 to 74", "bg-brand-100 text-brand-700"],
              ["Needs Practice", "Mastery 35 to 54", "bg-warn-500/15 text-warn-500"],
              ["Weak Topics", "Mastery below 35", "bg-danger-500/15 text-danger-500"]
            ].map(([title, body, tone]) => (
              <div key={title} className={`rounded-xl p-4 ${tone}`}>
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-xs opacity-80">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink-100 py-12" aria-labelledby="journey-heading">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="journey-heading" className="text-center text-2xl font-bold">Your learning journey</h2>
          <ol className="mt-6 flex flex-wrap justify-center gap-2">
            {JOURNEY.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-brand-500 bg-white px-4 py-1.5 text-sm font-semibold text-brand-700">{step}</span>
                {index < JOURNEY.length - 1 && <span aria-hidden="true" className="text-ink-500">→</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-2" aria-label="Study together">
        <div className="card">
          <h2 className="text-2xl font-bold">Buddy: one-to-one peer learning</h2>
          <p className="mt-2 text-sm text-ink-700">Get matched by class, goal, subjects, schedule and level. Send a request, study in a shared timed room, complete challenges together and track every session. Block or report at any time. Names stay anonymous.</p>
          <Link to={user && profile ? "/buddy" : "/login"} className="btn-primary mt-4">Find a Buddy</Link>
        </div>
        <div className="card">
          <h2 className="text-2xl font-bold">Groups: learn together</h2>
          <p className="mt-2 text-sm text-ink-700">Create groups around a class, JEE, NEET, a subject, a chapter or a project. Discover public groups, request to join, use invite codes or accept invitations. Discuss, run group study sessions and finish challenges as a team.</p>
          <Link to={user && profile ? "/groups" : "/login"} className="btn-primary mt-4">Join a Study Group</Link>
        </div>
      </section>

      <section className="bg-ink-100 py-14" aria-labelledby="rewards-heading">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="rewards-heading" className="text-3xl font-bold">Streaks and rewards that follow real effort</h2>
          <p className="mt-2 max-w-2xl text-ink-700">Streaks grow only on days with meaningful learning. XP and Orbit Coins are written by the backend for validated lessons, questions, assessments and sessions. Badges unlock on real conditions. Spin once a day and redeem goodies in the Orbit Store.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {["Streak", "XP", "Orbit Coins", "Badges", "Orbit Spin", "Goodies"].map((item) => <div key={item} className="card text-center text-sm font-semibold">{item}</div>)}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-2" aria-label="Projects and calendar">
        <div className="card">
          <h2 className="text-2xl font-bold">Projects</h2>
          <p className="mt-2 text-sm text-ink-700">Create school or personal projects, add tasks and deadlines, keep notes and resources, and watch progress update as you tick tasks off.</p>
        </div>
        <div className="card">
          <h2 className="text-2xl font-bold">Learning Calendar</h2>
          <p className="mt-2 text-sm text-ink-700">Every day you learn is recorded: study time, questions, accuracy, lessons, topics, XP and coins. Click a day to see exactly what you did.</p>
        </div>
      </section>

      <section className="bg-brand-700 py-16 text-white" aria-labelledby="mission-heading">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 id="mission-heading" className="text-3xl font-bold sm:text-4xl">Education Should Not Depend on Your Wallet.</h2>
          <p className="mt-4 text-brand-100">EduOrbit is built around the idea that every student deserves access to quality learning resources. Core educational content and learning tools should remain accessible without requiring students to pay for basic education.</p>
          <p className="mt-6 text-lg font-semibold">Learn freely. Learn consistently. Learn together.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="text-3xl font-bold">Start Your Learning Journey</h2>
        <Link to={startTo} className="btn-primary mt-6 px-8 py-3 text-base">Start Learning Free</Link>
      </section>
    </div>
  );
}

function PathCard({ title, subtitle, subjects, to }: { title: string; subtitle: string; subjects: readonly ("physics" | "chemistry" | "mathematics" | "biology")[]; to: string }) {
  return (
    <Link to={to} className="card block hover:border-brand-500">
      <h3 className="text-xl font-bold text-brand-700">{title}</h3>
      <p className="text-sm text-ink-500">{subtitle}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {subjects.map((subject) => <li key={subject} className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700">{SUBJECT_NAMES[subject]}</li>)}
      </ul>
    </Link>
  );
}
