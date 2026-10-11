"use client";

import { useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CommunityDp } from "../CommunityDp";
import { DpWithEventDate } from "../DpWithEventDate";
import { hasEventEnded } from "@/lib/communities/event-date";
import { eventChatName } from "@/lib/communities/event-chat-rules";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  createAndJoinEventChatFromClient,
  joinEventChatFromClient,
} from "@/lib/communities/event-chat-client";
import type { EventJoinAnswers } from "@/lib/communities/event-join-questions";
import { EventJoinQuestionsModal } from "./EventJoinQuestionsModal";

/**
 * The event page's door into the event's group chat.
 *
 * Owners and anybody who already confirmed they are going see one button that
 * opens the room. Everyone else gets the same confirm step the room's own page
 * shows — joining is compulsory to take part, so it is never silent.
 *
 * The row is offered for any event that has not ended, whether or not the room
 * exists yet: the group is created with the first join (see the chat route), so
 * a roomless event — a creation that failed, or a room since removed — still
 * has its door while the event is still to come or under way.
 */
export function EventChatPanel({
  chatCommunityId,
  chatCommunityName,
  chatCommunityImage,
  chatMemberCount,
  joined,
  communityId,
  eventId,
  eventTitle,
  eventDate,
  eventEnd,
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
  /** The event's community — where the on-demand create+join request is sent. */
  communityId: string;
  eventId: string;
  eventTitle: string;
  /** The event's start — its group chat's DP wears it as a calendar badge. */
  eventDate?: string | null;
  /** The event's end — what makes that badge say LIVE while it is under way. */
  eventEnd?: string | null;
}) {
  const router = useGuardedRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The host's compulsory questions open after the confirm dialog; the join
  // fires only from there, with the answers attached.
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openChat() {
    if (!chatCommunityId) return;
    router.push(`/dashboard/communities/${chatCommunityId}`);
  }

  async function handleJoin(answers: EventJoinAnswers) {
    setJoining(true);
    setError(null);
    try {
      let roomId = chatCommunityId;
      if (roomId) {
        await joinEventChatFromClient(roomId, answers);
      } else {
        // No room yet: the join is the moment it comes into being — the
        // server finds-or-creates it before putting the member in it. A public
        // event with no community is addressed as "public", the same scope
        // segment the RSVP route accepts.
        roomId = await createAndJoinEventChatFromClient(
          communityId || PUBLIC_CONTENT_SCOPE,
          eventId,
          answers,
        );
      }
      setConfirmOpen(false);
      setQuestionsOpen(false);
      router.push(`/dashboard/communities/${roomId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join the event chat.");
    } finally {
      setJoining(false);
    }
  }

  // The door closes when the event does. The badge keeps saying ENDED for a
  // day, but the banner is a call to action — join, or be in the room now —
  // and once the window has passed there is nothing left to be on time for.
  // The room itself keeps its history either way.
  const hasEnded = hasEventEnded(eventDate, eventEnd);

  if (hasEnded) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 md:px-5">
        {/* The room belongs to this event and the page knows its date, so the
            DP says which day it is for. */}
        <DpWithEventDate date={eventDate} endsAt={eventEnd} dpSize={32}>
          <CommunityDp
            imageUrl={chatCommunityImage ?? null}
            name={chatCommunityName ?? eventTitle}
            size={32}
            className="bg-surface-raised"
          />
        </DpWithEventDate>
        <div className="min-w-0 flex-1">
          {/* Roomless events get the name the room will be created with, so the
              row reads the same before and after the first join. */}
          <p className="truncate font-body text-sm font-medium text-foreground">
            {chatCommunityName ?? eventChatName(eventTitle)}
          </p>
          <p className="text-pretty font-body text-xs text-foreground-muted">
            {chatCommunityId &&
              typeof chatMemberCount === "number" &&
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
            onClick={() => {
              setConfirmOpen(false);
              setQuestionsOpen(true);
            }}
            disabled={joining}
            className="modal-btn modal-btn-primary"
          >
            <Check strokeWidth={2.5} size={15} />
            Continue
          </button>
        </div>
      </Modal>

      <EventJoinQuestionsModal
        open={questionsOpen}
        onClose={() => {
          if (joining) return;
          setQuestionsOpen(false);
        }}
        onSubmit={(answers) => void handleJoin(answers)}
        eventTitle={eventTitle}
        communityName={chatCommunityName}
        pending={joining}
        error={error}
        confirmLabel="Join chat"
      />
    </>
  );
}
