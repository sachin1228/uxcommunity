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
          <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#E4F222" />
            <stop offset="0.5" stopColor="#E4F222" />
            <stop offset="1" stopColor="#D5E31F" />
          </linearGradient>

          <linearGradient id="bubble" x1="128" y1="45" x2="128" y2="180" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.75" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#E8F1FC" />
          </linearGradient>
        </defs>

        <path
          d="M128 2 C77 2 44 8 25 26 C7 44 2 77 2 128 C2 179 7 212 26 230 C45 249 78 254 128 254 C178 254 211 249 230 230 C249 211 254 178 254 128 C254 77 249 44 230 26 C211 8 178 2 128 2Z"
          fill="#000000"
        />

        <path
          d="M128 4 C79 4 47 10 28 28 C10 47 4 79 4 128 C4 177 10 209 28 228 C47 246 79 252 128 252 C177 252 209 246 228 228 C246 209 252 177 252 128 C252 79 246 47 228 28 C209 10 177 4 128 4Z"
          fill="url(#bg)"
          stroke="#C5D21D"
          strokeWidth="2"
        />

        <path
          d="M128 6 C80 6 48 12 30 30 C12 48 7 80 7 128"
          fill="none"
          stroke="#F1F79B"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.45"
        />

        <path
          d="M128 47 C85 47 52 70 52 106 C52 126 63 142 83 152 C84 162 81 170 75 177 C74 179 76 181 79 181 C93 180 104 174 111 167 C116 168 122 168 128 168 C171 168 204 145 204 106 C204 70 171 47 128 47Z"
          fill="url(#bubble)"
        />
      </svg>
      <span className={wordmarkClassName}>uxcommunity</span>
    </span>
  );
}
