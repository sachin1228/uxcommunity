interface BrandLogoProps {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
}

/** Theme-safe UX Community mark and wordmark. */
export function BrandLogo({
  className = "",
  iconClassName = "size-7",
  wordmarkClassName = "text-[18px]",
}: BrandLogoProps) {
  return (
    <span
      className={`flex shrink-0 items-center gap-2 font-display font-semibold leading-none tracking-[-0.03em] text-foreground ${className}`}
      aria-label="UX Community"
    >
      <span
        className={`flex items-center justify-center rounded-sm bg-foreground text-background ${iconClassName}`}
        aria-hidden="true"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="size-[62%]"
        >
          <path
            d="M3 4.25v4.1c0 2.2 1.18 3.4 3.12 3.4 1.1 0 1.91-.42 2.45-1.12.5.7 1.32 1.12 2.43 1.12h2V9.9h-1.66c-1.17 0-1.73-.57-1.73-1.75v-3.9H7.6v4.1c0 1.02-.45 1.55-1.36 1.55-.86 0-1.24-.53-1.24-1.55v-4.1H3Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className={wordmarkClassName}>uxcommunity</span>
    </span>
  );
}
