/**
 * The wireframe globe for the "public" concept — the classic "globe with
 * meridians": a circle, two latitude lines, and a meridian lens. Drawn as
 * strokes like the lucide icons it sits beside (lock, pin), so it inherits
 * text color and matches their weight. Drop-in for lucide icons: accepts
 * size, strokeWidth, and className; the stroke defaults to the 2.5 the
 * badges draw their lock with.
 */
export function EarthGlyph({
  size = 16,
  strokeWidth = 2.5,
  className,
}: {
  size?: string | number;
  strokeWidth?: string | number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8" />
      <path d="M3.6 15h16.8" />
      <path d="M12 3a17 17 0 0 0 0 18" />
      <path d="M12 3a17 17 0 0 1 0 18" />
    </svg>
  );
}
