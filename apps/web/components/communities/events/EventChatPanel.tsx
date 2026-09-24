"use client";

import { useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { joinEventChatFromClient } from "@/lib/communities/event-chat-client";

/**
 * The event page's door into the event's group chat.
 *
 * Owners and anybody who already confirmed they are going see one button that
 * opens the room. Everyone else gets the same confirm step the room's own page
 * shows — joining is compulsory to take part, so it is never silent.
 */
export function EventChatPanel({
  chatCommunityId,
  chatCommunityName,
  chatCommunityImage,
  chatMemberCount,
  joined,
  eventTitle,
}: {
  /** Null while the group has not been created yet (it is created on demand). */
  chatCommunityId: string | null;
  /** The group chat community's name — shown as the panel's title. */
  chatCommunityName?: string | null;
  /** The group's display picture — the chat community's image. */
  chatCommunityImage?: string | null;
  /** How many people are in the group chat. */
  chatMemberCount?: number;
  joined: boolean;
  eventTitle: string;
}) {
  const router = useGuardedRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openChat() {
    if (!chatCommunityId) return;
    router.push(`/dashboard/communities/${chatCommunityId}`);
  }

  async function handleJoin() {
    if (!chatCommunityId) return;
    setJoining(true);
    setError(null);
    try {
      await joinEventChatFromClient(chatCommunityId);
      setConfirmOpen(false);
      openChat();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join the event chat.");
    } finally {
      setJoining(false);
    }
  }

  if (!chatCommunityId) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 md:px-5">
        <AvatarImg
          url={chatCommunityImage ?? null}
          name={chatCommunityName ?? eventTitle}
          size={32}
          className="shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-body text-sm font-medium text-foreground">{chatCommunityName ?? "Event chat"}</p>
          <p className="text-pretty font-body text-xs text-foreground-muted">
            {typeof chatMemberCount === "number" &&
              `${chatMemberCount} ${chatMemberCount === 1 ? "member" : "members"} · `}
            {joined
              ? "You're in — talk about this event with everyone going."
              : "Join the group chat for everyone going to this event."}
          </p>
          {error && <p className="mt-1 font-body text-xs text-red-400">{error}</p>}
        </div>
        {joined ? (
          <button
            type="button"
            onClick={openChat}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 font-body text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <MessageSquare strokeWidth={2.5} size={14} />
            Open chat
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3.5 py-2 font-body text-sm font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <MessageSquare strokeWidth={2.5} size={14} />
            Join event chat
          </button>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (joining) return;
          setConfirmOpen(false);
        }}
        title="Join this event's chat?"
      >
        <p className="font-body text-sm leading-6 text-foreground-muted">
          You&apos;ll join the group chat for{" "}
          <span className="font-medium text-foreground">{eventTitle}</span> — it is where everybody
          going talks about the event.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={joining}
            className="modal-btn modal-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={joining}
            className="modal-btn modal-btn-primary"
          >
            {joining ? <Spinner size={15} className="text-white" /> : <Check strokeWidth={2.5} size={15} />}
            {joining ? "Joining…" : "Join chat"}
          </button>
        </div>
      </Modal>
    </>
  );
}
