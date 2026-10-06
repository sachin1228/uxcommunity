"use client";

import { Plus } from "lucide-react";
import { openCreateCommunityDialog } from "@/lib/communities/create-community-dialog";

const paper = "#F6F2EA";

/**
 * The rail's create-community card — a crowd illustration doing the talking:
 * one line, one CTA, and the community you could start rising along the
 * bottom edge. Opens the same Create Community dialog the sidebar's "+" does
 * (see lib/communities/create-community-dialog.ts).
 */
export function CreateCommunityCard() {
  return (
    <section
      aria-labelledby="home-create-community-heading"
      className="overflow-hidden rounded-xl border border-stone-200 shadow-sm"
      style={{ backgroundColor: paper }}
    >
      <div className="px-4 pt-5 text-center">
        <h2
          id="home-create-community-heading"
          className="mb-3 font-display text-[15px] font-semibold leading-snug text-stone-900"
        >
          Start the room you wish existed.
        </h2>
        <button
          type="button"
          onClick={openCreateCommunityDialog}
          className="mb-4 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-stone-900 font-body text-[13px] font-semibold text-white transition-transform duration-150 ease-out hover:bg-stone-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F2EA]"
        >
          <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
          Create Community
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/home/illustrations/crowd-cheer.webp"
        alt="Illustration of a large cheerful crowd of designers waving and cheering"
        width={860}
        height={573}
        loading="lazy"
        decoding="async"
        className="h-36 w-full object-cover object-bottom"
      />
    </section>
  );
}
