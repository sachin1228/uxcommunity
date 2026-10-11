/**
 * Filter glyph — three descending rules (the Geist filter mark), used on the
 * Events page's filter-menu trigger.
 *
 * A filled `currentColor` path rather than a lucide stroke icon, so callers
 * size it with `size` and colour it with a text class exactly like the rest of
 * the icon set.
 */
export function FilterIcon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 2h14v1.5H1zm4 10h6v1.5H5zM3.75 7H3v1.5h10V7H3.75"
      />
    </svg>
  );
}
