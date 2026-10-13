interface BrandMarkProps {
  /** Rendered height in pixels; width follows the logo's own aspect ratio. */
  size?: number;
  /** false shows just the icon mark, with no wordmark. */
  withName?: boolean;
  className?: string;
}

// The full lockup is a 2:1 image (icon + "roomscape" wordmark); the icon-only
// mark is a 1:1 square crop of just the glyph. Each comes in a dark-ink and a
// white-ink variant, picked via the --lv-logo-full / --lv-logo-icon tokens —
// the same tokens as the rest of the lv-* palette, so a BrandMark inside
// `.lv-on-photo` (always a light surface, whatever the page theme is) picks
// the dark-ink logo there, and the normal page theme elsewhere.
const LOCKUP_RATIO = 1773 / 887;

export default function BrandMark({ size = 64, withName = true, className = "" }: BrandMarkProps) {
  const height = size;
  const width = withName ? Math.round(size * LOCKUP_RATIO) : size;

  return (
    <span
      role="img"
      aria-label="3D Layout System"
      className={`inline-block shrink-0 bg-contain bg-left bg-no-repeat ${className}`}
      style={{
        height,
        width,
        backgroundImage: `var(${withName ? "--lv-logo-full" : "--lv-logo-icon"})`,
      }}
    />
  );
}
