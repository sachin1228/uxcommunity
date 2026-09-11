/**
 * The community filter pill — one definition for every filter button in the
 * product: the tab filter rows (showcase, threads, resources, events) and the
 * create/edit modals (thread, resource, showcase).
 *
 * Borderless, with a soft tint at rest that lifts on hover and sits lightest
 * with full-contrast text when active. Because the tint is expressed as accent
 * opacity it reads correctly on the page background, on a modal panel and in
 * both color schemes.
 */
export function filterChip(active: boolean): string {
  return `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-body text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
    active
      ? "bg-accent/15 text-foreground"
      : "bg-accent-soft text-foreground-muted hover:bg-accent/10 hover:text-foreground"
  }`;
}
