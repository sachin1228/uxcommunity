interface BrandLogoProps {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
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

          <linearGradient id="uxc-bubble" x1="128" y1="47" x2="128" y2="181" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="72%" stopColor="#FCFCFC" />
            <stop offset="100%" stopColor="#E8E9ED" />
          </linearGradient>

          <filter id="uxc-bubbleShadow" x="35" y="35" width="190" height="165" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000000" floodOpacity="0.25" />
          </filter>

          <clipPath id="uxc-iconClip">
            <path d="M128 2 C77 2 44 8 25 26 C7 44 2 77 2 128 C2 179 7 212 26 230 C45 249 78 254 128 254 C178 254 211 249 230 230 C249 211 254 178 254 128 C254 77 249 44 230 26 C211 8 178 2 128 2Z" />
          </clipPath>
        </defs>

        <g clipPath="url(#uxc-iconClip)">
          <rect width="256" height="256" fill="url(#uxc-bg)" />
          <rect width="256" height="256" fill="url(#uxc-gloss)" />
          <rect width="256" height="256" fill="url(#uxc-depth)" />
        </g>

        <path
          d="M128 47 C85 47 52 70 52 106 C52 126 63 142 83 152 C84 162 81 170 75 177 C74 179 76 181 79 181 C93 180 104 174 111 167 C116 168 122 168 128 168 C171 168 204 145 204 106 C204 70 171 47 128 47Z"
          fill="url(#uxc-bubble)"
          filter="url(#uxc-bubbleShadow)"
        />
      </svg>
      <span className={wordmarkClassName}>uxcommunity</span>
    </span>
  );
}
