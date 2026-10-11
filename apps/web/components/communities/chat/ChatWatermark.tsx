"use client";

/**
 * TEMPORARY — watermark variant preview for event group rooms.
 *
 * Draws the room's name (the event's title) as a paper-style watermark behind
 * the chat messages, like the grid on security paper. Five variants, switchable
 * live from the floating chip rail (also temporary). Everything here except the
 * chosen variant gets deleted once one is picked.
 */

export type WatermarkVariant = "A" | "B" | "C" | "D" | "E";

const INK = "font-display text-foreground";

/** A — one tilted line, sized to the pane so the whole title always reads. */
function VariantDiagonalLine({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* SVG text with textLength: the line stretches to exactly fill the
          viewBox, so no title length ever runs off the pane. */}
      <svg
        viewBox="0 0 200 28"
        className="w-[88%] -rotate-[12deg]"
        preserveAspectRatio="xMidYMid meet"
      >
        <text
          x="100"
          y="14"
          textAnchor="middle"
          dominantBaseline="middle"
          textLength="196"
          lengthAdjust="spacingAndGlyphs"
          fill="currentColor"
          className={`text-[17px] font-bold uppercase tracking-tight opacity-[0.04] ${INK}`}
        >
          {text}
        </text>
      </svg>
    </div>
  );
}

/** B — repeated small caps tiled on a diagonal, sparse like security paper. */
function VariantSecurityTile({ text }: { text: string }) {
  const tile = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return (
    <div className="absolute -inset-[35%] -rotate-[27deg]">
      <div className="flex h-full w-full flex-col justify-around">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className={`flex justify-around ${row % 2 === 0 ? "pr-28" : "pl-28"}`}
          >
            {[0, 1, 2].map((col) => (
              <span
                key={col}
                className={`whitespace-nowrap text-xs font-semibold uppercase tracking-[0.4em] opacity-[0.035] ${INK}`}
              >
                {tile}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** C — upright, centered, letterhead style. */
function VariantCenterStamp({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-8">
      <span
        className={`text-center text-[clamp(2rem,6vw,4.5rem)] font-semibold uppercase tracking-[0.18em] text-balance opacity-[0.04] ${INK}`}
      >
        {text}
      </span>
    </div>
  );
}

/** D — the full title as a wrapped block anchored to the bottom-right. */
function VariantCornerBlock({ text }: { text: string }) {
  return (
    <div className="absolute inset-x-0 bottom-8 flex justify-end px-8">
      <span
        className={`max-w-[16rem] text-right text-[clamp(1.5rem,3.5vw,2.75rem)] font-bold uppercase leading-tight text-balance opacity-[0.04] ${INK}`}
      >
        {text}
      </span>
    </div>
  );
}

/** E — two vertical ribbons hugging the right edge. */
function VariantEdgeRibbon({ text }: { text: string }) {
  return (
    <div className="absolute inset-y-0 right-5 flex items-center gap-20 [writing-mode:vertical-rl]">
      <span
        className={`rotate-180 whitespace-nowrap text-sm font-semibold uppercase tracking-[0.5em] opacity-[0.035] ${INK}`}
      >
        {text}
      </span>
      <span
        className={`whitespace-nowrap text-sm font-semibold uppercase tracking-[0.5em] opacity-[0.035] ${INK}`}
      >
        {text}
      </span>
    </div>
  );
}

export function ChatWatermark({
  text,
  variant,
}: {
  /** The room's name — the event's title. */
  text: string;
  variant: WatermarkVariant | "off";
}) {
  if (!text || variant === "off") return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {variant === "A" ? (
        <VariantDiagonalLine text={text} />
      ) : variant === "B" ? (
        <VariantSecurityTile text={text} />
      ) : variant === "C" ? (
        <VariantCenterStamp text={text} />
      ) : variant === "D" ? (
        <VariantCornerBlock text={text} />
      ) : (
        <VariantEdgeRibbon text={text} />
      )}
    </div>
  );
}

/** TEMPORARY — the chip rail that flips between variants while deciding. */
export function WatermarkVariantSwitcher({
  value,
  onChange,
}: {
  value: WatermarkVariant | "off";
  onChange: (variant: WatermarkVariant | "off") => void;
}) {
  return (
    <div className="fixed bottom-28 right-6 z-50 flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 shadow-lg">
      <span className="px-1.5 font-mono text-[10px] uppercase tracking-widest text-foreground-subtle">
        wm
      </span>
      {(["A", "B", "C", "D", "E", "off"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-7 rounded-full px-2 font-mono text-[11px] font-semibold uppercase transition-colors ${
            value === option
              ? "bg-accent text-accent-foreground"
              : "text-foreground-muted hover:bg-surface-raised"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
