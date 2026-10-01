import { CheckmarkRegular } from "@fluentui/react-icons/headless/svg/checkmark";

/**
 * Read-receipt double check. Fluent ships no double-tick glyph, so this
 * composes two checkmarks: the second sits down-right, offset by 17% of
 * the box on both axes — the same geometry as the `CheckCheck` icon this
 * app used before the Fluent migration.
 */
export function DoubleCheckIcon({
  fontSize = 13,
  className,
}: {
  fontSize?: number;
  className?: string;
}) {
  return (
    <span className="inline-flex" aria-hidden="true">
      <CheckmarkRegular fontSize={fontSize} className={className} />
      <CheckmarkRegular
        fontSize={fontSize}
        className={className}
        style={{
          marginTop: Math.round(fontSize * 17) / 100,
          marginLeft: Math.round(fontSize * -83) / 100,
        }}
      />
    </span>
  );
}
