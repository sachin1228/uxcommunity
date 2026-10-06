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
      className="overflow-hidden rounded-xl border border-border bg-background-subtle shadow-sm"
    >
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
        >
          <Sparkles size={14} strokeWidth={2.25} />
        </span>
        <h2
          id="home-create-community-heading"
          className="font-display text-sm font-semibold leading-snug tracking-[-0.01em] text-foreground"
        >
          Create your first community
        </h2>
      </div>
      <p className="px-4 pb-1 pt-2.5 font-body text-xs leading-relaxed text-foreground-muted">
        Start a space for your craft, invite the people you build with, and run the
        conversations, events and work in one place.
      </p>
      <div className="px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={openCreateCommunityDialog}
          className="h-9 w-full cursor-pointer rounded-full bg-accent font-body text-[13px] font-semibold text-accent-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-subtle"
        >
          Create Community
        </button>
      </div>
    </section>
  );
}
