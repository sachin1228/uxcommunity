/**
 * The filled-earth glyph for the "public" concept. Lucide's stroke Earth (and
 * its Globe2 alias) collapses into a wireframe ball at the 11–15px sizes the
 * badges and switchers use, so the public marker is a filled disc with
 * continent cut-outs that stays readable at small sizes.
 *
 * Drop-in for lucide icons: accepts (and ignores) strokeWidth.
 */
export function EarthGlyph({
  size = 16,
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
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Zm-1.2-15.9c-.5.1-.9.5-1.2 1-.3.5-.7.9-1.3 1-.6.1-1.1-.1-1.5-.5A8.04 8.04 0 0 1 9.4 5.2c.3-.3.8-.1 1.4-.1Zm3.6.5c.4.4 1 .6 1.6.5.7-.1 1.3-.5 1.7-1.1a8.05 8.05 0 0 1 2.8 3.7c.1.5-.2 1-.7 1.4-.6.4-1 .9-1.2 1.6-.1.5-.5.9-1.1.9-.7 0-1.4.1-2 .4-.5.3-.9.7-1.1 1.3-.2.6-.6 1.1-1.3 1.2-.8.1-1.5.5-2 1.1-.4.5-1 .7-1.6.6a8.02 8.02 0 0 1-3.4-3.9c-.2-.6.1-1.1.5-1.6.5-.5.8-1.1.9-1.8.1-.6.5-1.1 1.1-1.3.8-.3 1.5-.8 2-1.5.3-.5.9-.7 1.5-.6.8.1 1.5-.1 2.2-.5.5-.3 1.1-.2 1.6.2-.3.3-.3.7 0 .8Z"
      />
    </svg>
  );
}
