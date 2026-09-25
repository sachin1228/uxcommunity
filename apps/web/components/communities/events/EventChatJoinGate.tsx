"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, MapPin, MessageSquare, Users, Video } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { GradientButton } from "@/components/ui/GradientButton";
import { joinEventChatFromClient } from "@/lib/communities/event-chat-client";
import { EventJoinQuestionsModal } from "./EventJoinQuestionsModal";
import type { EventJoinAnswers } from "@/lib/communities/event-join-questions";
import {
  eventZoneLabel,
  eventZoneTooltip,
  formatEventTimeRange,
} from "@/lib/communities/event-display";
import { communityFeedLayout } from "../feed-layout";

/**
 * Shown instead of the chat when a non-member opens an event's group chat.
 *
 * The room itself is gated server-side — the community read model and the
 * message route both refuse non-members — so this page cannot paint a
 * read-only preview or a composer. What it can do is the one thing the member
 * actually needs: show them the event and take their confirmation. Joining is
 * compulsory to take part, which is why the button opens a confirm dialog and
 * nothing happens until it is answered.
 */

function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtSchedule(startsAt: string, endsAt: string | null) {
  return `${fmtEventDate(startsAt)} · ${formatEventTimeRange(startsAt, endsAt)}`;
}

export interface EventChatJoinGateProps {
  communityId: string;
  communityName: string;
  memberCount: number;
  rsvpCount: number;
  event: {
    id: string;
    title: string;
    event_date: string;
    end_date: string | null;
    cover_image_url: string | null;
    is_online: boolean;
    location: string | null;
  };
}

export function EventChatJoinGate({
  communityId,
  communityName,
  memberCount,
  rsvpCount,
  event,
}: EventChatJoinGateProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The host's compulsory questions open after the confirm dialog, and the
  // join is sent only from there — answers in hand.
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(answers: EventJoinAnswers) {
    setJoining(true);
    setError(null);
    try {
      await joinEventChatFromClient(communityId, answers);
      setConfirmOpen(false);
      // Same URL, now a member: the server render flips to the real chat.
      router.refresh();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join the event chat.");
      setJoining(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.content} ${communityFeedLayout.detailPage}`}>
        <div className="overflow-hidden rounded-xl border border-border bg-background-subtle">
          {event.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.cover_image_url}
              alt=""
              className="h-44 w-full object-cover sm:h-56"
            />
          )}

          <div className="px-5 py-6 md:px-8 md:py-7">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground-muted">
              <MessageSquare strokeWidth={2.5} size={11} />
              Event chat
            </span>

            <h1 className="mt-4 text-balance font-display text-xl font-semibold text-foreground">
              {event.title}
            </h1>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              The group chat for this event, hosted by {communityName}.
            </p>

            <dl className="mt-5 flex flex-col gap-2.5 font-body text-sm text-foreground-muted">
              <div className="flex items-center gap-2">
                <CalendarDays strokeWidth={2.5} size={14} className="shrink-0 text-foreground-subtle" />
                {/* The viewer's own clock, named — a host in another zone set
                    this time, and this is what it is here. */}
                <span title={eventZoneTooltip(event.event_date)}>
                  {fmtSchedule(event.event_date, event.end_date)}{" "}
                  <span className="font-mono text-[11px] text-foreground-subtle">
                    ({eventZoneLabel(event.event_date)})
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {event.is_online ? (
                  <>
                    <Video strokeWidth={2.5} size={14} className="shrink-0 text-foreground-subtle" />
                    <span>Online event</span>
                  </>
                ) : (
                  <>
                    <MapPin strokeWidth={2.5} size={14} className="shrink-0 text-foreground-subtle" />
                    <span>{event.location ?? "Location shared by the host"}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Users strokeWidth={2.5} size={14} className="shrink-0 text-foreground-subtle" />
                <span>
                  {rsvpCount} going · {memberCount} in this chat
                </span>
              </div>
            </dl>

            <div className="mt-6 flex flex-col items-start gap-3">
              <GradientButton onClick={() => setConfirmOpen(true)} className="h-10 px-4 text-sm">
                <MessageSquare strokeWidth={2.5} size={15} />
                Join event chat
              </GradientButton>
              <p className="max-w-md text-pretty font-body text-xs leading-5 text-foreground-subtle">
                Confirming is how you get in — the chat is only for people going, and everyone
                inside can talk about the event together.
              </p>
              {error && <p className="font-body text-xs text-red-400">{error}</p>}
            </div>
          </div>
        </div>
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
          You&apos;ll join <span className="font-medium text-foreground">{communityName}</span> and
          can talk with everyone going to{" "}
          <span className="font-medium text-foreground">{event.title}</span>.
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
        eventTitle={event.title}
        communityName={communityName}
        pending={joining}
        error={error}
        confirmLabel="Join chat"
      />
    </div>
  );
}
