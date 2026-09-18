/**
 * Hero illustration as inline SVG: students at a laptop and tablet, an OrbitAI panel, question and
 * quiz cards, a progress chart, books and subtle orbit rings. No raster asset, so it is sharp on
 * every screen, weighs a few KB and respects prefers-reduced-motion through the reduce-motion class.
 */
export function HeroVisual() {
  return (
    <svg viewBox="0 0 640 480" role="img" aria-labelledby="hero-title hero-desc" className="h-auto w-full max-w-2xl">
      <title id="hero-title">Students learning together with OrbitAI</title>
      <desc id="hero-desc">Three students around a laptop and tablet, an OrbitAI chat panel, a question card, a quiz card, a progress chart, books and orbit rings.</desc>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef4ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f5bea" />
          <stop offset="1" stopColor="#1d3ca0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="640" height="480" rx="32" fill="url(#bg)" />
      <g fill="none" stroke="#93b0ff" strokeOpacity="0.55" strokeWidth="1.5" className="hero-orbits">
        <ellipse cx="320" cy="250" rx="290" ry="120" transform="rotate(-14 320 250)" />
        <ellipse cx="320" cy="250" rx="240" ry="85" transform="rotate(18 320 250)" strokeDasharray="6 8" />
      </g>
      <circle cx="78" cy="152" r="7" fill="#f59e0b" />
      <circle cx="565" cy="330" r="5" fill="#2f5bea" />
      <circle cx="590" cy="120" r="9" fill="#d9e6ff" stroke="#2f5bea" strokeWidth="1.5" />

      <g transform="translate(60 300)">
        <rect x="0" y="0" width="80" height="14" rx="3" fill="#1d3ca0" />
        <rect x="6" y="-14" width="74" height="14" rx="3" fill="#2f5bea" />
        <rect x="2" y="-28" width="70" height="14" rx="3" fill="#f59e0b" />
        <rect x="8" y="-42" width="64" height="14" rx="3" fill="#16a34a" />
      </g>

      <g transform="translate(150 190)">
        <rect x="0" y="0" width="220" height="140" rx="10" fill="#0f172a" />
        <rect x="8" y="8" width="204" height="118" rx="6" fill="url(#screen)" />
        <rect x="-16" y="140" width="252" height="12" rx="6" fill="#334155" />
        <g fill="#ffffff" fillOpacity="0.9">
          <rect x="22" y="22" width="90" height="8" rx="4" />
          <rect x="22" y="38" width="150" height="6" rx="3" fillOpacity="0.6" />
          <rect x="22" y="50" width="130" height="6" rx="3" fillOpacity="0.6" />
        </g>
        <g transform="translate(22 70)">
          <rect x="0" y="30" width="18" height="24" rx="3" fill="#93b0ff" />
          <rect x="26" y="18" width="18" height="36" rx="3" fill="#d9e6ff" />
          <rect x="52" y="8" width="18" height="46" rx="3" fill="#f59e0b" />
          <rect x="78" y="0" width="18" height="54" rx="3" fill="#ffffff" />
        </g>
        <g transform="translate(130 74)" fill="#ffffff">
          <rect x="0" y="0" width="60" height="10" rx="5" fillOpacity="0.9" />
          <rect x="0" y="16" width="60" height="10" rx="5" fillOpacity="0.5" />
          <rect x="0" y="32" width="40" height="10" rx="5" fillOpacity="0.5" />
        </g>
      </g>

      <g transform="translate(395 150)">
        <rect x="0" y="0" width="190" height="120" rx="14" fill="#ffffff" stroke="#d9e6ff" strokeWidth="2" />
        <circle cx="24" cy="24" r="10" fill="#2f5bea" />
        <ellipse cx="24" cy="24" rx="15" ry="6" fill="none" stroke="#93b0ff" strokeWidth="1.4" transform="rotate(-25 24 24)" />
        <rect x="44" y="16" width="60" height="8" rx="4" fill="#0f172a" />
        <rect x="44" y="30" width="120" height="6" rx="3" fill="#e2e8f0" />
        <rect x="16" y="52" width="150" height="20" rx="10" fill="#eef4ff" />
        <rect x="26" y="59" width="90" height="6" rx="3" fill="#2f5bea" />
        <rect x="40" y="82" width="134" height="20" rx="10" fill="#f1f5f9" />
        <rect x="50" y="89" width="70" height="6" rx="3" fill="#64748b" />
      </g>

      <g transform="translate(410 300)">
        <rect x="0" y="0" width="160" height="96" rx="12" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
        <rect x="14" y="14" width="100" height="8" rx="4" fill="#0f172a" />
        <g transform="translate(14 34)">
          <circle cx="6" cy="6" r="6" fill="#16a34a" />
          <rect x="18" y="3" width="80" height="6" rx="3" fill="#e2e8f0" />
          <circle cx="6" cy="26" r="6" fill="none" stroke="#94a3b8" strokeWidth="2" />
          <rect x="18" y="23" width="64" height="6" rx="3" fill="#e2e8f0" />
          <circle cx="6" cy="46" r="6" fill="none" stroke="#94a3b8" strokeWidth="2" />
          <rect x="18" y="43" width="72" height="6" rx="3" fill="#e2e8f0" />
        </g>
      </g>

      <g transform="translate(60 120)">
        <rect x="0" y="0" width="120" height="70" rx="12" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
        <rect x="12" y="12" width="70" height="8" rx="4" fill="#0f172a" />
        <rect x="12" y="28" width="96" height="6" rx="3" fill="#e2e8f0" />
        <rect x="12" y="46" width="44" height="14" rx="7" fill="#f59e0b" fillOpacity="0.25" />
        <rect x="62" y="46" width="44" height="14" rx="7" fill="#16a34a" fillOpacity="0.25" />
      </g>

      <g>
        <circle cx="130" cy="392" r="22" fill="#f4c7a1" />
        <path d="M108 392c0-16 10-26 22-26s22 10 22 26" fill="#3b2f2f" />
        <rect x="100" y="414" width="60" height="50" rx="16" fill="#2f5bea" />
        <circle cx="270" cy="380" r="22" fill="#c68642" />
        <path d="M248 378c0-16 10-24 22-24s22 8 22 24l-6 4h-32z" fill="#1f1a1a" />
        <rect x="240" y="402" width="60" height="58" rx="16" fill="#16a34a" />
        <circle cx="380" cy="395" r="22" fill="#8d5524" />
        <path d="M358 396c0-18 10-28 22-28s22 10 22 28c-6-8-12-10-22-10s-16 2-22 10z" fill="#111" />
        <rect x="350" y="417" width="60" height="48" rx="16" fill="#f59e0b" />
      </g>
    </svg>
  );
}
