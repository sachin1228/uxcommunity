export const communityFeedLayout = {
  content: "mx-auto w-full max-w-[40rem]",
  detailContent: "mx-auto w-full max-w-[40rem]",
  gutters: "",
  pageHeader: "py-7",
  pageHeaderWithFilters: "pb-2 pt-7",
  pageHeaderMain: "flex min-w-0 items-start justify-between gap-3",
  pageHeaderFilters: "mt-6",
  row: "py-6",
  cardList: "flex flex-col gap-4 pb-6",
  card: "overflow-hidden rounded-xl border bg-background-subtle border-border px-5 py-5 md:px-6",
  cardInteractive: "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  detailCard: "overflow-hidden rounded-xl border bg-background-subtle border-border px-5 py-6 md:px-8",
  detailPage: "py-6",
  detailSection: "",
  sectionLabel: "",
  dividerList: "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t before:border-border",
  dividerBottom: "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border",
  dividerY: "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t before:border-border after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border",
  /**
   * Borderless filter pill shared by every community tab (threads, showcase,
   * resources, events) so the states can never drift apart:
   * soft tint at rest, lighter on hover, lightest with full-contrast text when active.
   */
  filterChip: (active: boolean) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-body text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
      active
        ? "bg-accent/15 text-foreground"
        : "bg-accent-soft text-foreground-muted hover:bg-accent/10 hover:text-foreground"
    }`,
  emptyState: "relative flex min-h-52 flex-col items-center justify-center px-6 py-12 text-center",
  emptyIcon: "mb-4 text-foreground-subtle",
  emptyTitle: "font-display text-base font-semibold text-foreground",
  emptyDescription: "mt-1 max-w-md text-pretty font-body text-sm leading-6 text-foreground-muted",
} as const;
