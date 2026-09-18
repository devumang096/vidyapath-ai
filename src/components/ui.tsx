import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Strength } from "../lib/types";
import { STRENGTH_LABELS } from "../lib/types";
import { strengthTone } from "../lib/recommend";

export function Spinner({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-500" role="status" aria-live="polite">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Grey placeholder blocks shown while a card's data loads. */
export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card animate-pulse ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={`mb-2 h-3 rounded bg-ink-200 ${index === 0 ? "w-1/3" : index % 2 ? "w-full" : "w-2/3"}`} />
      ))}
    </div>
  );
}

/** Uniform loading / error / empty handling. Every Firebase-backed page goes through this. */
export function AsyncState({
  loading,
  error,
  empty,
  loadingLabel = "Loading...",
  skeletonLines = 3,
  emptyTitle = "Nothing here yet",
  emptyBody,
  emptyAction,
  onRetry,
  children
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  loadingLabel?: string;
  skeletonLines?: number;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  emptyAction?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div>
        <span className="sr-only" role="status">{loadingLabel}</span>
        <Skeleton lines={skeletonLines} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="card border-danger-500/30 bg-red-50" role="alert">
        <p className="font-semibold text-danger-500">Something went wrong.</p>
        <p className="mt-1 text-sm text-ink-700">{error}</p>
        {onRetry && <button type="button" className="btn-secondary mt-3" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  if (empty) return <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />;
  return <>{children}</>;
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card border-dashed text-center">
      <p className="font-semibold text-ink-900">{title}</p>
      {body && <p className="mt-1 text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, crumbs }: { title: string; subtitle?: ReactNode; action?: ReactNode; crumbs?: { label: string; to: string }[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap gap-1 text-xs text-ink-500">
            {crumbs.map((crumb, index) => (
              <span key={crumb.to} className="flex items-center gap-1">
                <Link to={crumb.to} className="hover:text-brand-600 hover:underline">{crumb.label}</Link>
                {index < crumbs.length - 1 && <span aria-hidden="true">/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ label, value, hint, to }: { label: string; value: ReactNode; hint?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </>
  );
  return to ? <Link to={to} className="card block hover:border-brand-500">{body}</Link> : <div className="card">{body}</div>;
}

export function ProgressBar({ value, label, tone = "brand" }: { value: number; label?: string; tone?: "brand" | "success" | "warn" | "danger" }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = tone === "success" ? "bg-success-500" : tone === "warn" ? "bg-warn-500" : tone === "danger" ? "bg-danger-500" : "bg-brand-500";
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-ink-500">
          <span>{label}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "progress"}>
        <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "success" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-ink-200 text-ink-700",
    brand: "bg-brand-100 text-brand-700",
    success: "bg-success-500/15 text-success-500",
    warn: "bg-warn-500/15 text-warn-500",
    danger: "bg-danger-500/15 text-danger-500"
  };
  return <span className={`tag ${tones[tone]}`}>{children}</span>;
}

export function StrengthTag({ strength }: { strength: Strength }) {
  return <Tag tone={strengthTone(strength)}>{STRENGTH_LABELS[strength]}</Tag>;
}

export function AiLabel({ source }: { source: "gemini" | "fallback" | null }) {
  if (source === "fallback") return <span className="tag bg-warn-500/15 text-warn-500">Content-authored (OrbitAI offline)</span>;
  return <span className="tag bg-brand-100 text-brand-700">OrbitAI</span>;
}

export function ContentPreparing({ what = "this topic" }: { what?: string }) {
  return <EmptyState title={`Content for ${what} is being prepared.`} body="EduOrbit only shows real lessons and questions. This part of the syllabus is in the structure but not yet authored." />;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 text-sm text-danger-500" role="alert">{message}</p>;
}

export function RewardToast({ result, onDone }: { result: { xp: number; coins: number; streak?: { current: number; incremented: boolean; protectionUsed?: boolean }; badges?: string[] } | null; onDone: () => void }) {
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [result, onDone]);
  if (!result) return null;
  const parts = [];
  if (result.xp > 0) parts.push(`+${result.xp} XP`);
  if (result.coins > 0) parts.push(`+${result.coins} Orbit Coins`);
  if (result.coins < 0) parts.push(`${result.coins} Orbit Coins`);
  if (result.streak?.incremented) parts.push(`Streak ${result.streak.current} days${result.streak.protectionUsed ? " (protection used)" : ""}`);
  if (result.badges?.length) parts.push(`Badge: ${result.badges.map((badge) => badge.replace(/_/g, " ")).join(", ")}`);
  if (parts.length === 0) return null;
  return (
    <div className="fixed bottom-20 right-4 z-40 rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-4" role="status" aria-live="polite">
      {parts.join(" · ")}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (next: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} className={value === tab.id ? "btn-primary" : "btn-secondary"} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
