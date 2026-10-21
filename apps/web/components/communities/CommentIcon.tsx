/**
 * Shared comment icon used by the comment counts on community cards
 * (threads, resources, events, showcase) and the thread image lightbox.
 *
 * Drawn in the heart's 16-unit box with the same 1.5 stroke and the same
 * `currentColor` outline, so the pair reads at one weight and one size.
 */
export function CommentIcon({
  className = "transform-gpu",
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M1.334 7C1.334 3.667 4.001 2 8.001 2C12.001 2 14.668 3.667 14.668 7C14.668 10.333 12.001 12 8.001 12V14C8.001 14 1.334 12 1.334 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.334 5.666H10.668M5.334 8.333H8.001"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
