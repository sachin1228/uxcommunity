interface BrandLogoProps {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
  /** Render the SVG mark only, without the "uxcommunity" wordmark. */
  markOnly?: boolean;
}

/**
 * UX Community's shared logo mark and wordmark.
 *
 * The mark is a bare inline SVG — no tile behind it — so it stays crisp, works
 * without a separate asset request, and inherits `currentColor` to follow the
 * surrounding text colour on every surface and theme.
 */
export function BrandLogo({
  className = "",
  iconClassName = "h-7 w-7",
  wordmarkClassName = "text-[18px]",
  markOnly = false,
}: BrandLogoProps) {
  return (
    <span
      className={`flex shrink-0 items-center gap-2 font-display font-semibold leading-none tracking-tight text-foreground ${className}`}
      aria-label="uxcommunity"
    >
      <svg
        className={iconClassName}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label="uxcommunity logo"
      >
        <path
          fill="currentColor"
          d="M16 4H8a7 7 0 000 14h4v4l8.16-5.39A6.78 6.78 0 0023 11a7 7 0 00-7-7zm-8 8.25A1.25 1.25 0 119.25 11 1.25 1.25 0 018 12.25zm4 0A1.25 1.25 0 1113.25 11 1.25 1.25 0 0112 12.25zm4 0A1.25 1.25 0 1117.25 11 1.25 1.25 0 0116 12.25z"
        />
      </svg>
      {!markOnly && <span className={wordmarkClassName}>uxcommunity</span>}
    </span>
  );
}
