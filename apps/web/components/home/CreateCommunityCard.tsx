"use client";

import { Sparkles } from "lucide-react";
import { openCreateCommunityDialog } from "@/lib/communities/create-community-dialog";

/**
 * The rail's create-community card.
 *
 * Deliberately a plain card, not a list: it replaces the retired trending strip
 * with the one action a member can take from here — start a community of their
 * own. The button opens the same Create Community dialog the sidebar's "+" does
 * (see lib/communities/create-community-dialog.ts).
 */
export function CreateCommunityCard() {
  return (
    <section
      aria-labelledby="home-create-community-heading"
      className="overflow-hidden rounded-xl border border-border bg-background-subtle"
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        <Sparkles size={15} strokeWidth={2.5} className="text-foreground-muted" aria-hidden="true" />
        <h2
          id="home-create-community-heading"
          className="font-display text-sm font-semibold text-foreground"
        >
          Create your first community
        </h2>
      </div>
      <p className="px-4 pb-3 pt-2 font-body text-xs leading-relaxed text-foreground-muted">
        Start a space for your craft, invite the people you build with, and run the
        conversations, events and work in one place.
      </p>
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={openCreateCommunityDialog}
          className="w-full rounded-full bg-accent px-3 py-2 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Create Community
        </button>
      </div>
    </section>
  );
}
