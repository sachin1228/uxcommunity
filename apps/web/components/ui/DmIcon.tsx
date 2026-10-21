/**
 * Direct messages — an outlined speech bubble with three dots.
 *
 * Drawn as a stroked 24×24 glyph so it matches the rest of the icon set
 * (lucide on web, Feather on mobile) instead of the earlier filled mark.
 * Callers size it with `size` and colour it with a text class.
 */
export function DmIcon({
  size = 16,
  className,
  strokeWidth = 2.5,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 4H8a7 7 0 0 0 0 14h4v4l8.16-5.39A6.78 6.78 0 0 0 23 11a7 7 0 0 0-7-7Z" />
      <circle cx="8" cy="11" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
