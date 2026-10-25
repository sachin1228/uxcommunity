"use client";

import { Timer } from "lucide-react";
import { CHAT_MESSAGE_RETENTION_DAYS } from "@/lib/communities/message-retention";

/**
 * The disappearing-messages notice at the start of a community chat, in the
 * shape of WhatsApp's system message: centered, muted, with no author and no
 * timestamp — a policy note, not a message.
 *
 * Rendered by MessageList only once the true start of the history is loaded
 * (hasMoreAbove === false) and above the first date pill, so it can never
 * float mid-stream while older pages are still unloaded. A room with no
 * messages does not show it at all — a fresh chat opens on the welcome copy
 * alone, the way the mobile app renders it, and the notice joins the timeline
 * with the first message. The window it names comes from the same constant the
 * server-side sweep deletes by (lib/communities/message-retention.ts), so the
 * promise cannot drift from the enforcement.
 */
export function DisappearingNotice() {
  return (
    <div className="flex justify-center px-5 py-3">
      <p className="flex max-w-[85%] items-start gap-1.5 rounded-lg bg-surface-raised px-3 py-1.5 font-body text-[11px] leading-snug text-foreground-muted shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
        <Timer size={12} strokeWidth={2.5} className="mt-[1px] shrink-0" aria-hidden />
        <span>
          All messages will disappear from this chat for everyone after{" "}
          {CHAT_MESSAGE_RETENTION_DAYS} days.
        </span>
      </p>
    </div>
  );
}
