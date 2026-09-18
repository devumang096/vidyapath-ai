import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";

/**
 * Buddy (one-to-one study partner) ships in a later build phase: matching by class, goal, subjects,
 * schedule and level; requests; a shared timed study room; challenges; unmatch, block and report.
 * Until the server-side flow exists this page says so rather than showing buttons that do nothing.
 */
export default function BuddyPage({ room = false }: { room?: boolean }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={room ? "Buddy Study Room" : "Buddy"} subtitle="One-to-one peer learning with a shared study room and challenges." />
      <div className="card border-warn-500/40 bg-warn-500/10 text-sm text-ink-700" role="status">
        <p className="font-semibold">Buddy is scheduled for a later release of this build.</p>
        <p className="mt-1">What is coming: anonymous matching by class, goal, subjects, schedule and level; send, accept and decline requests; a shared study room with start, pause, resume, stop and per-student time; challenges rewarded only for validated activity; unmatch, block and report.</p>
        <p className="mt-1">Tell us your learning preferences and find a study partner once this ships. Until then, <Link to="/groups" className="text-brand-600 underline">Groups</Link> is also on the roadmap and <Link to="/practice" className="text-brand-600 underline">Practice</Link> is live.</p>
      </div>
    </div>
  );
}
