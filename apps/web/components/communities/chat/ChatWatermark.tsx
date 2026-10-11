"use client";

/**
 * The event room's watermark: the room's name (the event's title) drawn very
 * faintly on the pane, like the grid on security paper, behind the messages.
 *
 * Rendered only for event group rooms (see CommunityChat, which keeps the pane
 * paper — the dot grid plus this — in a layer under the transparent scroller,
 * so the watermark stays put while messages scroll).
 */
export function ChatWatermark({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden px-8"
    >
      <span className="text-balance text-center font-watermark text-[32px] uppercase italic tracking-normal text-foreground opacity-[0.04]">
        {text}
      </span>
    </div>
  );
}
