"use client";

/**
 * The event room's watermark: the room's name (the event's title) drawn very
 * faintly on the pane, like the grid on security paper, behind the messages.
 *
 * Rendered only for event group rooms (see CommunityChat), as a grid item
 * sharing a cell with the message scroller — the flexbox centers the text on
 * exactly the visible message area, and the watermark stays put while the
 * messages scroll.
 */
export function ChatWatermark({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative col-start-1 row-start-1 flex select-none items-center justify-center overflow-hidden px-8"
    >
      <span className="text-balance text-center font-watermark text-[32px] font-medium italic tracking-normal text-foreground opacity-[0.08]">
        {text}
      </span>
    </div>
  );
}
