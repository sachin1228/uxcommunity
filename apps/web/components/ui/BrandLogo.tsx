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
        viewBox="0 0 16 16"
        fill="none"
        role="img"
        aria-label="uxcommunity logo"
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          transform="translate(-0.8 -0.8) scale(1.1)"
          d="M14.666 7C14.666 3.667 11.999 2 7.999 2C3.999 2 1.332 3.667 1.332 7C1.332 10.333 3.999 12 7.999 12V14C7.999 14 14.666 12 14.666 7Z M4.583 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M7.25 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M9.917 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z"
        />
      </svg>
      {!markOnly && <span className={wordmarkClassName}>uxcommunity</span>}
    </span>
  );
}
