import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";

/**
 * Groups ship in a later build phase: create, discover and request to join, invite codes with expiry and
 * usage limits, in-app invitations, owner/admin/member roles enforced server-side, discussions with
 * reactions and moderation, shared study sessions and group challenges.
 */
export default function GroupsPage({ view = "list" }: { view?: "list" | "create" | "detail" | "discussion" }) {
  const titles = { list: "Groups", create: "Create Group", detail: "Group", discussion: "Group Discussion" };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={titles[view]} subtitle="Collaborative learning around a class, exam, subject, chapter or project." />
      <div className="card border-warn-500/40 bg-warn-500/10 text-sm text-ink-700" role="status">
        <p className="font-semibold">Groups are scheduled for a later release of this build.</p>
        <p className="mt-1">What is coming: public and private groups; discover and request to join; invite codes like EDU-7K4P9 with expiry, usage limits and revocation; in-app invitations; owner, admin and member roles enforced by the backend; discussions with reactions, helpful marks, report and block; shared study sessions; group challenges with real progress.</p>
        <p className="mt-1">Join a study group or create one to learn together once this ships. <Link to="/learn" className="text-brand-600 underline">Learn</Link> and <Link to="/practice" className="text-brand-600 underline">Practice</Link> are live now.</p>
      </div>
    </div>
  );
}
