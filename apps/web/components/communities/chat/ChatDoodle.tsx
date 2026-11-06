/**
 * The community's doodle paper — a decorative pen-and-ink sketch sheet
 * stretched across the full width of the message pane, behind the timeline,
 * shared by the community room and the direct-message thread.
 *
 * Painted through a CSS mask rather than an <img> so the artwork's
 * `currentColor` strokes take the theme's foreground colour: the doodle is a
 * white-tinted texture in the dark theme and a dark-tinted one in light, in
 * both cases at ~4.5% opacity. Purely decorative, so it never takes a pointer
 * event and stays out of the accessibility tree.
 */
export function ChatDoodle() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-foreground opacity-[0.045]"
      style={{
        WebkitMaskImage: "url(/background-doodle.svg)",
        maskImage: "url(/background-doodle.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        // Cover, not a fixed tile: the artwork is always scaled to span the
        // pane's whole width, so a wide thread never shows a repeated strip
        // down its sides.
        WebkitMaskSize: "cover",
        maskSize: "cover",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
