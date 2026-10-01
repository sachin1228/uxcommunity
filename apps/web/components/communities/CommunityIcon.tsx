import { ImagePlus } from "lucide-react";

/**
 * Single community avatar fallback, used everywhere a community has no image
 * (sidebar, chat header, explore cards, admin rows, empty states). Replaces
 * the old per-type emoji fallbacks with one consistent design-system icon.
 *
 * The ring lives here, not on CommunityDp's shared container: only the
 * fallback reads as an empty slot ("add a picture here"), so a community
 * WITH an image keeps the plain unringed circle.
 */
export function CommunityIcon({
  size = 40,
  iconSize,
  className = "",
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
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none border border-black/10 dark:border-white/15 bg-background ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <ImagePlus
        size={iconSize ?? Math.round(size * 0.5)}
        strokeWidth={2.5}
        className="text-foreground-muted"
      />
    </div>
  );
}
