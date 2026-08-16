/**
 * Plain loading spinner. Defaults to the accent blue so every loading state
 * in the app shares one consistent look. Pass an explicit `text-*` class
 * (e.g. `text-white` on accent buttons) to override the color.
 */
export function Spinner({ className = "", size }: { className?: string; size?: number }) {
  // If the caller passes an explicit text color, respect it (e.g. white
  // spinners on accent buttons). Otherwise default to the accent blue.
  const hasColorClass = /(^|\s)text-/.test(className);
  return (
    <svg
      className={`animate-spin ${hasColorClass ? "" : "text-accent"} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...(size ? { width: size, height: size } : {})}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Spinning material — a stroked arc whose thickness matches the track's
          stroke width, so it never looks thicker than the circle. */}
      <path
        className="opacity-75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M12 2a10 10 0 0 1 10 10"
      />
    </svg>
  );
}
