/**
 * Read-receipt double check. Kept in the original lucide `CheckCheck`
 * geometry (ISC licensed) — same fallback as the brand marks in
 * BrandIcons — because Fluent ships no double-tick glyph and the
 * composed two-checkmark variant read worse in the chat bubbles.
 */
export function DoubleCheckIcon({
  fontSize = 13,
  className,
}: {
  fontSize?: number;
  className?: string;
}) {
  return (
    <svg
      width={fontSize}
      height={fontSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}
