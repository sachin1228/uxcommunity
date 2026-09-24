"use client";

import { useState } from "react";
import { Check, Lock, MessageCircle, MessagesSquare, Sparkles } from "lucide-react";
import { CommunityDp } from "./CommunityDp";
import { CommunityNameBadges } from "./CommunityBadges";
import { dedupeFetch } from "@/lib/dedupe-fetch";

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
}) {
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(hasPendingRequest);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/join`, { method: "POST" });
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

  const publicBits = [
    publicCounts.threads ? { icon: MessagesSquare, label: `${publicCounts.threads} public thread${publicCounts.threads === 1 ? "" : "s"}` } : null,
    publicCounts.events ? { icon: MessageCircle, label: `${publicCounts.events} public event${publicCounts.events === 1 ? "" : "s"}` } : null,
    publicCounts.showcase ? { icon: Sparkles, label: `${publicCounts.showcase} public showcase post${publicCounts.showcase === 1 ? "" : "s"}` } : null,
  ].filter((bit): bit is { icon: typeof MessageCircle; label: string } => bit !== null);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
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
          {joined ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1.5 font-body text-xs font-medium text-accent">
              <Check strokeWidth={2.5} size={12} />
              Joined — reopening this page shows the full community
            </span>
          ) : requested ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
              <Lock strokeWidth={2.5} size={11} />
              Request sent — waiting for the owner&apos;s approval
            </span>
          ) : canJoin ? (
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={joining}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {joining ? "Joining…" : isPrivate ? "Request to join" : "Join community"}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
              <Lock strokeWidth={2.5} size={11} />
              {isPrivate ? "This community is private" : "Update your profile to join"}
            </span>
          )}
          {error && <p className="font-body text-xs text-red-400">{error}</p>}
          <p className="font-body text-xs text-foreground-subtle">
            You&apos;re seeing this community&apos;s public posts from the home feed. Joining adds the
            community&apos;s chat and every post to your sidebar.
          </p>
        </div>
      </div>
    </div>
  );
}
