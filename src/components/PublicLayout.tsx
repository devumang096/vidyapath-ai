import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brand } from "./Brand";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/learn", label: "Learn" },
  { to: "/jee", label: "JEE" },
  { to: "/neet", label: "NEET" },
  { to: "/orbitai", label: "OrbitAI" },
  { to: "/buddy", label: "Buddy" },
  { to: "/groups", label: "Groups" },
  { to: "/about", label: "About" }
];

const FOOTER: { heading: string; links: { label: string; to: string }[] }[] = [
  { heading: "EduOrbit", links: [{ label: "About", to: "/about" }, { label: "Contact", to: "/contact" }, { label: "Careers", to: "/contact#careers" }] },
  { heading: "Learning", links: [{ label: "Classes 9 to 12", to: "/learn" }, { label: "JEE", to: "/jee" }, { label: "NEET", to: "/neet" }, { label: "Practice", to: "/practice" }, { label: "Assessments", to: "/assessments" }, { label: "OrbitAI", to: "/orbitai" }] },
  { heading: "Community", links: [{ label: "Buddy", to: "/buddy" }, { label: "Groups", to: "/groups" }, { label: "Guidelines", to: "/guidelines" }, { label: "Safety", to: "/safety" }, { label: "Report", to: "/safety#report" }] },
  { heading: "Support", links: [{ label: "Help Center", to: "/help" }, { label: "FAQ", to: "/help#faq" }, { label: "Contact", to: "/contact" }] },
  { heading: "Legal", links: [{ label: "Privacy Policy", to: "/privacy" }, { label: "Terms", to: "/terms" }, { label: "Cookie Policy", to: "/cookies" }, { label: "Account Deletion", to: "/account-deletion" }] }
];

/** Public pages: marketing navbar with the auth-aware CTA and the five-column footer. */
export function PublicLayout() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const startTo = user && profile ? "/dashboard" : "/login";
  return (
    <div className="min-h-screen bg-white text-ink-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Brand compact />
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-100"}`}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user && profile ? (
              <Link to="/dashboard" className="btn-secondary hidden sm:inline-flex">Dashboard</Link>
            ) : (
              <Link to="/login" className="btn-secondary hidden sm:inline-flex">Login</Link>
            )}
            <Link to={startTo} className="btn-primary">Start Learning Free</Link>
            <button type="button" className="btn-secondary lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>☰</button>
          </div>
        </div>
        {open && (
          <nav aria-label="Primary mobile" className="border-t border-ink-200 bg-white px-4 py-2 lg:hidden">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-ink-700"}`}>
                {item.label}
              </NavLink>
            ))}
            {!(user && profile) && <Link to="/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-ink-700">Login</Link>}
          </nav>
        )}
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="border-t border-ink-200 bg-ink-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-5">
          {FOOTER.map((column) => (
            <div key={column.heading}>
              <h2 className="text-sm font-semibold text-ink-900">{column.heading}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}><Link to={link.to} className="text-ink-700 hover:text-brand-600 hover:underline">{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-4 text-xs text-ink-500">
          <span>EduOrbit. Learn freely. Learn consistently. Learn together.</span>
          <span>Physics, Chemistry, Mathematics and Biology for Classes 9 to 12, JEE and NEET.</span>
        </div>
      </footer>
    </div>
  );
}
