import { CommentRegular } from "@fluentui/react-icons/headless/svg/comment";

/**
 * Shared comment icon used by the comment counts on community cards
 * (threads, resources, events, showcase) and the thread image lightbox.
 *
 * Fluent 2 `Comment` glyph in outline style; it inherits `currentColor`,
 * so the icon follows the parent text color (subtle gray, white on hover).
 */
export function CommentIcon({
  className = "transform-gpu",
}: {
  className?: string;
}) {
  return <CommentRegular fontSize={18} className={className} aria-hidden="true" />;
}
