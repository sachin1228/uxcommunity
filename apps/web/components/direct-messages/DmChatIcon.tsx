/**
 * Direct messages — the WDS `wds-ic-chat` glyph, used for every DM entry
 * point and empty state (the topbar button, the list/thread placeholders and
 * the profile's Message chip).
 *
 * A filled `currentColor` path rather than a lucide stroke icon, so callers
 * size it with `size` and colour it with a text class exactly like the rest
 * of the icon set.
 */
export function DmChatIcon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 9 .94 5.53A1 1 0 0 1 1.79 4h17.54C20.81 4 22 5.2 22 6.67v10.66c0 1.48-1.2 2.67-2.67 2.67H5.67A2.67 2.67 0 0 1 3 17.33V9Zm2-.55L3.53 6h15.8c.37 0 .67.3.67.67v10.66c0 .37-.3.67-.67.67H5.67a.67.67 0 0 1-.67-.67V8.45Z"
      />
      <path d="M7 10a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Z" />
    </svg>
  );
}
