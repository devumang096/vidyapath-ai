import { Link } from "react-router-dom";

/** Orbit mark: a dot with two tilted rings. Inline SVG so it is crisp at every size and costs no request. */
export function OrbitMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <circle cx="16" cy="16" r="4.5" fill="var(--color-brand-600)" />
      <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none" stroke="var(--color-brand-500)" strokeWidth="1.6" transform="rotate(-25 16 16)" />
      <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none" stroke="var(--color-brand-300)" strokeWidth="1.2" transform="rotate(35 16 16)" />
      <circle cx="27" cy="9.5" r="1.8" fill="var(--color-accent-500)" />
    </svg>
  );
}

export function Brand({ to = "/", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2" aria-label="EduOrbit home">
      <OrbitMark />
      <span>
        <span className="block text-lg font-bold leading-tight text-ink-900">EduOrbit</span>
        {!compact && <span className="block text-[11px] leading-tight text-ink-500">Quality Education. Without Barriers.</span>}
      </span>
    </Link>
  );
}
