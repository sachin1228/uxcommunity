/**
 * Shared comment icon used by the comment counts on community cards
 * (threads, resources, events, showcase) and the thread image lightbox.
 *
 * Renders the exact sprite-referencing markup the design calls for:
 * `<use href="/creators/community-sprite.svg#comment-16">` against a
 * sprite served from `apps/web/public/creators/community-sprite.svg`.
 * The sprite symbol is outline-stroked and uses `currentColor`, so the
 * icon follows the parent text color (subtle gray, white on hover).
 */
export function CommentIcon({
  className = "transform-gpu",
}: {
  className?: string;
}) {
  return (
    <svg
      width="16"
      height="16"
      fill="currentColor"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <use href="/creators/community-sprite.svg#comment-16" />
    </svg>
  );
}
