/**
 * Notification bell — the Remix Icon `notification-line` glyph, used for the
 * notifications entry point (the sidebar bell and its unread badge).
 *
 * A filled `currentColor` path rather than a lucide stroke icon, so callers
 * size it with `size` and colour it with a text class exactly like the rest of
 * the icon set.
 */
export function NotificationBellIcon({
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
      <path d="M20 17H22V19H2V17H4V10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10V17ZM18 17V10C18 6.68629 15.3137 4 12 4C8.68629 4 6 6.68629 6 10V17H18ZM9 21H15V23H9V21Z" />
    </svg>
  );
}
