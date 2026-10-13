interface BrandMarkProps {
  /** Pixel size of the glyph. */
  size?: number;
  withName?: boolean;
  className?: string;
}

/** A floor-plan glyph: outer walls, one partition and a door swing. */
export function BrandGlyph({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="3" width="22" height="22" rx="5" />
      <path d="M14 3v8" />
      <path d="M3 16h7" />
      <path d="M14 25v-5a5 5 0 0 1 5-5h6" strokeWidth="1.5" />
    </svg>
  );
}

export default function BrandMark({ size = 28, withName = true, className = "" }: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-lv-ink ${className}`}>
      <BrandGlyph size={size} />
      {withName && <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">3D Layout System</span>}
    </span>
  );
}
