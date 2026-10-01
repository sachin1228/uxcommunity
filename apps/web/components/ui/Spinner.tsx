import { SpinnerIosRegular } from "@fluentui/react-icons/headless/svg/spinner-ios";

/**
 * Plain loading spinner, backed by the Fluent `Spinner iOS` glyph. Defaults to
 * the accent blue so every loading state in the app shares one consistent
 * look. Pass an explicit `text-*` class (e.g. `text-white` on accent buttons)
 * to override the color.
 */
export function Spinner({ className = "", size }: { className?: string; size?: number }) {
  // If the caller passes an explicit text color, respect it (e.g. white
  // spinners on accent buttons). Otherwise default to the accent blue.
  const hasColorClass = /(^|\s)text-/.test(className);
  return (
    <SpinnerIosRegular
      className={`animate-spin ${hasColorClass ? "" : "text-accent"} ${className}`}
      {...(size ? { fontSize: size } : {})}
      aria-hidden="true"
    />
  );
}
