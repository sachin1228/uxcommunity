/**
 * Text for a *collapsed* card body (thread title / event description).
 *
 * Why this exists: `TruncateMarkup` decides how much text to keep by measuring
 * the rendered height and dividing it by the line height — it counts *line
 * boxes*, not visible words. Body text is rendered with `whitespace-pre-wrap`,
 * so a blank line inside the kept prefix still counts as a line while showing
 * nothing. The truncation then stops at the paragraph break, the kept text ends
 * the line early, and the "… Read more" affordance is pushed onto a line of its
 * own — often one line past the clamp the card asked for:
 *
 *   DesignUp™ Conference is turning 10. And I get to be in the room again.
 *   … Read more            ← second line has no body text at all
 *
 * Flattening every whitespace run (including paragraph breaks) to a single
 * space for the collapsed preview means the kept words always flow to fill the
 * clamp and "… Read more" trails the last visible line. The *expanded* body
 * still renders the stored text verbatim, so paragraph breaks come back when
 * the reader taps through.
 */
export function flattenPreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
