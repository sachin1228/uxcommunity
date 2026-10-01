import { AlertRegular } from "@fluentui/react-icons/headless/svg/alert";

/**
 * Notification bell — the Fluent `Alert` glyph, used for the notifications
 * entry point (the sidebar bell and its unread badge).
 */
export function NotificationBellIcon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return <AlertRegular fontSize={size} className={className} aria-hidden="true" />;
}
