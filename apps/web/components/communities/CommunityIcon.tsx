import { PeopleRegular } from "@fluentui/react-icons/headless/svg/people";

/**
 * Single community avatar fallback, used everywhere a community has no image
 * (sidebar, chat header, explore cards, admin rows, empty states). Replaces
 * the old per-type emoji fallbacks with one consistent design-system icon.
 */
export function CommunityIcon({
  size = 40,
  iconSize,
  className = "bg-surface-raised",
}: {
  /** Container diameter in px (square circle). */
  size?: number;
  /** Icon size in px — defaults to roughly half the container. */
  iconSize?: number;
  /** Extra classes for the circular container (background, etc.). */
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <PeopleRegular
        fontSize={iconSize ?? Math.round(size * 0.5) + 2}
        className="text-foreground-muted"
      />
    </div>
  );
}
