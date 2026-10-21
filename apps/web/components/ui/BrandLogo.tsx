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
 * The mark is inline SVG so it stays crisp, works without a separate asset
 * request, and can be used consistently across the public and member areas.
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
        width="256"
        height="256"
        viewBox="0 0 256 256"
        fill="none"
        role="img"
        aria-label="uxcommunity logo"
      >
        <defs>
          <linearGradient id="uxc-bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#30323A" />
            <stop offset="38%" stopColor="#24262D" />
            <stop offset="100%" stopColor="#1D1F26" />
          </linearGradient>

          <radialGradient
            id="uxc-gloss"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(105 15) rotate(70) scale(210 180)"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.12" />
            <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.035" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="uxc-depth" x1="128" y1="110" x2="128" y2="256" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
          </linearGradient>

          <clipPath id="uxc-clip">
            <path d="M128 2 C77 2 44 8 25 26 C7 44 2 77 2 128 C2 179 7 212 26 230 C45 249 78 254 128 254 C178 254 211 249 230 230 C249 211 254 178 254 128 C254 77 249 44 230 26 C211 8 178 2 128 2Z" />
          </clipPath>
        </defs>

        <g clipPath="url(#uxc-clip)">
          <rect width="256" height="256" fill="url(#uxc-bg)" />
          <rect width="256" height="256" fill="url(#uxc-gloss)" />
          <rect width="256" height="256" fill="url(#uxc-depth)" />
        </g>

        <g transform="translate(49 49) scale(6.6)" fill="#FFFFFF">
          <path
            d="M16 4H8a7 7 0 0 0 0 14h4v4l8.16-5.39A6.78 6.78 0 0 0 23 11a7 7 0 0 0-7-7 M8 12.25A1.25 1.25 0 1 1 9.25 11 1.25 1.25 0 0 1 8 12.25 m4 0A1.25 1.25 0 1 1 13.25 11 1.25 1.25 0 0 1 12 12.25 m4 0A1.25 1.25 0 1 1 17.25 11 1.25 1.25 0 0 1 16 12.25"
          />
        </g>
      </svg>
      {!markOnly && <span className={wordmarkClassName}>uxcommunity</span>}
    </span>
  );
}
