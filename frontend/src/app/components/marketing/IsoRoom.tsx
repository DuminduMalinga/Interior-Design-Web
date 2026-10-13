/** A small isometric room: floor, two walls, a bed and a side table. Decorative. */
export default function IsoRoom({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" className={className}>
      <g stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
        {/* walls */}
        <path d="M20 96 100 56V8L20 48Z" fill="currentColor" fillOpacity="0.05" />
        <path d="M100 56 180 96V48L100 8Z" fill="currentColor" fillOpacity="0.09" />
        {/* floor */}
        <path d="M100 136 20 96 100 56 180 96Z" fill="currentColor" fillOpacity="0.14" />
        {/* window */}
        <path d="M124 34 156 50V70L124 54Z" strokeOpacity="0.6" />
        {/* bed */}
        <path d="M96 118 60 100 100 80 136 98Z" fill="var(--lv-accent)" fillOpacity="0.55" />
        <path d="M60 100v8l36 18v-8M96 126l40-20v-8" />
        <path d="M100 80 136 98V84L100 66Z" fill="currentColor" fillOpacity="0.18" />
        {/* side table */}
        <path d="M148 110 138 105 148 100 158 105Z" fill="currentColor" fillOpacity="0.3" />
        <path d="M138 105v8l10 5v-8M148 118l10-5v-8" />
      </g>
    </svg>
  );
}
