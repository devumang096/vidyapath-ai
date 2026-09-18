import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "../context/AuthContext";
import { auth } from "../lib/firebase";
import { errorMessage } from "../lib/callables";
import { effectiveStreak } from "../../functions/src/lib/streak.js";
import { istToday } from "../lib/format";
import { Brand } from "./Brand";
import { InlineError } from "./ui";

const NAV: { to: string; label: string; icon: string; mobile?: boolean }[] = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠", mobile: true },
  { to: "/learn", label: "Learn", icon: "📚", mobile: true },
  { to: "/jee", label: "JEE", icon: "🧮" },
  { to: "/neet", label: "NEET", icon: "🧬" },
  { to: "/practice", label: "Practice", icon: "✏️", mobile: true },
  { to: "/assessments", label: "Assessments", icon: "📝" },
  { to: "/orbitai", label: "OrbitAI", icon: "🪐", mobile: true },
  { to: "/buddy", label: "Buddy", icon: "🤝" },
  { to: "/groups", label: "Groups", icon: "👥" },
  { to: "/progress", label: "Progress", icon: "📈" },
  { to: "/calendar", label: "Calendar", icon: "🗓️" },
  { to: "/rewards", label: "Rewards", icon: "🎁" },
  { to: "/projects", label: "Projects", icon: "🧪" },
  { to: "/profile", label: "Profile", icon: "👤" }
];

export function AppShell() {
  const { user, profile, streak, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const streakToday = streak ? effectiveStreak(streak, istToday()) : 0;

  const nav = (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"}`}>
          <span aria-hidden="true" className="w-5 text-center">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
      {isAdmin && (
        <NavLink to="/admin" className={({ isActive }) => `mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100"}`}>
          <span aria-hidden="true" className="w-5 text-center">🛡️</span>
          Admin
        </NavLink>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden w-60 shrink-0 border-r border-ink-200 bg-white p-4 lg:block">
        <Brand to="/dashboard" />
        <div className="mt-6">{nav}</div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-white p-4" onClick={(event) => event.stopPropagation()} aria-label="Navigation drawer">
            <Brand to="/dashboard" />
            <div className="mt-6">{nav}</div>
          </aside>
        </div>
      )}
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3">
          <button type="button" className="btn-secondary lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button>
          <form
            role="search"
            className="flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`);
            }}
          >
            <label htmlFor="global-search" className="sr-only">Search subjects, chapters, topics, lessons, questions and groups</label>
            <input id="global-search" className="input max-w-md" placeholder="Search chapters, topics, questions..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </form>
          <div className="hidden items-center gap-3 text-sm sm:flex">
            <Link to="/rewards" title="Current streak" className="hover:underline">🔥 {streakToday}</Link>
            <Link to="/rewards" title="XP" className="hover:underline">⚡ {profile?.xp ?? 0}</Link>
            <Link to="/rewards" title="Orbit Coins" className="hover:underline">🪙 {profile?.coins ?? 0}</Link>
          </div>
          <div className="relative">
            <button type="button" className="btn-secondary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              {profile?.name?.split(" ")[0] ?? "Account"}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-ink-200 bg-white p-2 text-sm shadow-lg">
                <Link role="menuitem" to="/profile" className="block rounded-lg px-3 py-2 hover:bg-ink-100">Profile</Link>
                <Link role="menuitem" to="/settings" className="block rounded-lg px-3 py-2 hover:bg-ink-100">Settings</Link>
                <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-ink-100" onClick={() => logout().then(() => navigate("/login"))}>Log out</button>
              </div>
            )}
          </div>
        </header>
        {user && !user.emailVerified && user.providerData.some((provider) => provider.providerId === "password") && <VerifyBanner />}
        <main id="main" className="flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          <Outlet />
        </main>
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-200 bg-white lg:hidden">
          {NAV.filter((item) => item.mobile).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-brand-700" : "text-ink-500"}`}>
              <span aria-hidden="true" className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("eduorbit.verifyBannerDismissed") === "1");
  if (dismissed) return null;
  async function resend() {
    try {
      if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      setSent(true);
    } catch (caught) {
      console.error("Could not send verification email", caught);
      setError(errorMessage(caught));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warn-500/40 bg-warn-500/10 px-4 py-2 text-sm text-ink-700" role="status">
      <span>Verify your email to secure your account. Check your inbox for the EduOrbit link.</span>
      {sent ? <span className="font-semibold text-success-500">Verification email sent.</span> : <button type="button" className="btn-ghost py-1" onClick={() => void resend()}>Resend email</button>}
      <button type="button" className="btn-ghost ml-auto py-1" onClick={() => { sessionStorage.setItem("eduorbit.verifyBannerDismissed", "1"); setDismissed(true); }}>Later</button>
      <InlineError message={error} />
    </div>
  );
}
