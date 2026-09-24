"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Lock, MessageCircle, MessagesSquare, Sparkles } from "lucide-react";
import { CommunityDp } from "./CommunityDp";
import { CommunityNameBadges } from "./CommunityBadges";
import { dedupeFetch } from "@/lib/dedupe-fetch";

/** Hard cap shared with the join route's server-side slice. */
export const REQUEST_MESSAGE_MAX = 500;

/**
 * Join state machine shared by every community-preview surface: one-tap join
 * for open types, a request flow (with an optional note) for private
 * communities, and a closed row for communities this member cannot join
 * (profile-derived types their profile doesn't match).
 *
 * Returns everything the card's action row needs to render its states.
 */
export function useCommunityJoin(
  communityId: string,
  canJoin: boolean,
  isPrivate: boolean,
  hasPendingRequest = false,
) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(hasPendingRequest);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitJoin(message: string | null) {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/join`, {
        method: "POST",
        ...(message && isPrivate ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to join. Please try again.");
      } else if (data.status === "requested") {
        setRequested(true);
      } else {
        setJoined(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  /** Opens the full community page (used by the member's View community row). */
  function viewCommunity() {
    router.push(`/dashboard/communities/${communityId}`);
  }

  return { joining, requested, joined, error, canJoin, isPrivate, submitJoin, viewCommunity };
}

/** The "already a member" row — a plain link into the full community. */
function ViewCommunityRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      View community
      <ArrowRight strokeWidth={2.5} size={14} />
    </button>
  );
}

/** The pending-request row. */
function RequestPendingRow() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
      <Clock strokeWidth={2.5} size={11} />
      Request sent — waiting for the owner&apos;s approval
    </span>
  );
}

/** The closed row: a private community, or a profile-gated official one. */
function ClosedRow({ isPrivate }: { isPrivate: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
      <Lock strokeWidth={2.5} size={11} />
      {isPrivate ? "This community is private" : "Update your profile to join"}
    </span>
  );
}

/** Textarea for the optional note accompanying a private-community request. */
function RequestMessageInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="w-full">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, REQUEST_MESSAGE_MAX))}
        disabled={disabled}
        rows={3}
        placeholder="Add a short note with your request (optional)…"
        aria-label="Request message"
        className="field w-full resize-none font-body text-sm"
      />
      <p className="mt-1 text-right font-body text-[10px] text-foreground-subtle">
        {value.length}/{REQUEST_MESSAGE_MAX}
      </p>
    </div>
  );
}

/**
 * The join/request action row for a non-member. Public communities get the
 * one-tap button; private ones get the request flow with an optional note.
 */
function JoinActions({
  state,
}: {
  state: ReturnType<typeof useCommunityJoin>;
}) {
  const { joining, error, canJoin, isPrivate, submitJoin } = state;
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState("");

  if (!canJoin) return <ClosedRow isPrivate={isPrivate} />;

  if (!isPrivate) {
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void submitJoin(null)}
          disabled={joining}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {joining ? "Joining…" : "Join community"}
        </button>
        {error && <p className="font-body text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  const trimmed = message.trim();
  return (
    <div className="flex w-full flex-col items-start gap-2">
      {!showMessage ? (
        <button
          type="button"
          onClick={() => setShowMessage(true)}
          disabled={joining}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          <Lock strokeWidth={2.5} size={13} />
          Request to join
        </button>
      ) : (
        <>
          <p className="font-body text-xs text-foreground-muted">
            Tell the admins why you&apos;d like to join — they&apos;ll see this with your request.
          </p>
          <RequestMessageInput value={message} onChange={setMessage} disabled={joining} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitJoin(trimmed || null)}
              disabled={joining}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {joining ? "Sending…" : "Send request"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMessage(false);
                setMessage("");
              }}
              disabled={joining}
              className="rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
    </div>
  );
}

/**
 * The shared body of the community preview — the exact card the community
 * page renders full-page (wrapped in CommunityPreview below) and the
 * homepage's "posted in …" modal opens with. Kept as one component so both
 * surfaces can never diverge.
 *
 * The action row depends on the viewer: members get a plain "View community"
 * link, non-members get Join (public) or Request to join with an optional
 * note (private).
 */
export function CommunityPreviewCard({
  communityId,
  name,
  type,
  isPrivate,
  imageUrl,
  description,
  memberCount,
  publicCounts,
  canJoin = true,
  hasPendingRequest = false,
  joined = false,
  footerNote = "You're seeing this community's public posts from the home feed. Joining adds the community's chat and every post to your sidebar.",
}: {
  communityId: string;
  name: string;
  type: string;
  isPrivate: boolean;
  imageUrl: string | null;
  description: string | null;
  memberCount: number;
  /** The public content the home feed surfaced here — empty when none. */
  publicCounts: { threads?: number; events?: number; resources?: number; showcase?: number };
  canJoin?: boolean;
  hasPendingRequest?: boolean;
  /** True when the viewer already belongs to this community. */
  joined?: boolean;
  footerNote?: string;
}) {
  const state = useCommunityJoin(communityId, canJoin, isPrivate, hasPendingRequest);
  const { requested } = state;
  const isMember = joined || state.joined;

  const publicBits = [
    publicCounts.threads ? { icon: MessagesSquare, label: `${publicCounts.threads} public thread${publicCounts.threads === 1 ? "" : "s"}` } : null,
    publicCounts.events ? { icon: MessageCircle, label: `${publicCounts.events} public event${publicCounts.events === 1 ? "" : "s"}` } : null,
    publicCounts.showcase ? { icon: Sparkles, label: `${publicCounts.showcase} public showcase post${publicCounts.showcase === 1 ? "" : "s"}` } : null,
  ].filter((bit): bit is { icon: typeof MessageCircle; label: string } => bit !== null);

  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-background-subtle">
      <div className="flex items-center gap-3 px-5 pt-5">
        <CommunityDp imageUrl={imageUrl} name={name} size={48} className="bg-surface" />
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 font-display text-base font-semibold text-foreground">
            <span className="truncate">{name}</span>
            <CommunityNameBadges type={type} isPrivate={isPrivate} />
          </h1>
          <p className="font-body text-xs text-foreground-muted">
            {memberCount.toLocaleString()} member{memberCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {description && (
        <p className="px-5 pt-3 font-body text-sm leading-relaxed text-foreground-muted">{description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        {publicBits.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-body text-[11px] text-foreground-muted"
          >
            <Icon strokeWidth={2.5} size={11} className="text-foreground-subtle" />
            {label}
          </span>
        ))}
      </div>

      <div className="flex flex-col items-start gap-2 px-5 py-5">
        {isMember ? (
          <ViewCommunityRow onClick={state.viewCommunity} />
        ) : requested ? (
          <RequestPendingRow />
        ) : (
          <JoinActions state={state} />
        )}
        {footerNote && (
          <p className="font-body text-xs text-foreground-subtle">{footerNote}</p>
        )}
      </div>
    </div>
  );
}

/**
 * What a non-member sees instead of the chat when they open a community from
 * a public home-feed card. The room itself stays gated — the read model and
 * the message routes refuse non-members, so there is no read-only chat to
 * render — but the community itself is not a secret: its public posts are on
 * the homepage feed, so the page introduces the community and offers Join.
 *
 * `canJoin` is false when the community is closed to this member (profile-
 * derived types their profile does not match, or a private community whose
 * request the caller already knows is pending), which turns Join into a
 * disabled row instead of a button that cannot work.
 */
export function CommunityPreview({
  communityId,
  name,
  type,
  isPrivate,
  imageUrl,
  description,
  memberCount,
  publicCounts,
  canJoin = true,
  hasPendingRequest = false,
  joined = false,
}: {
  communityId: string;
  name: string;
  type: string;
  isPrivate: boolean;
  imageUrl: string | null;
  description: string | null;
  memberCount: number;
  /** The public content the home feed surfaced here — empty when none. */
  publicCounts: { threads?: number; events?: number; resources?: number; showcase?: number };
  canJoin?: boolean;
  hasPendingRequest?: boolean;
  joined?: boolean;
}) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
      <CommunityPreviewCard
        communityId={communityId}
        name={name}
        type={type}
        isPrivate={isPrivate}
        imageUrl={imageUrl}
        description={description}
        memberCount={memberCount}
        publicCounts={publicCounts}
        canJoin={canJoin}
        hasPendingRequest={hasPendingRequest}
        joined={joined}
      />
    </div>
  );
}
