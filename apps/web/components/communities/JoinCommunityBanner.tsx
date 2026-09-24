"use client";

import { useState } from "react";
import { Check, Lock, Users } from "lucide-react";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { invalidateOnJoin } from "@/lib/communities/cache";

/**
 * A lightweight "Join <community>" banner for the top of a public post's
 * detail page, shown to non-members only.
 *
 * It mirrors the full community preview's rules and states: one-tap join for
 * open types, a request flow for private communities (the server answers
 * `status: "requested"`), and a closed reason for communities this member
 * cannot join (profile-derived types their profile doesn't match). Joining
 * also refreshes the shared community caches, so the sidebar picks the
 * community up immediately — the same hand-off the Explore page does.
 */
export function JoinCommunityBanner({
  communityId,
  communityName,
  isPrivate,
  canJoin = true,
  hasPendingRequest = false,
}: {
  communityId: string;
  communityName: string;
  isPrivate: boolean;
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
        // The sidebar and Explore page should show the membership right away.
        invalidateOnJoin(communityId);
        setJoined(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Users strokeWidth={2.5} size={15} className="shrink-0 text-foreground-subtle" />
        <p className="truncate font-body text-sm text-foreground-muted">
          {joined ? (
            <>You joined <span className="font-medium text-foreground">{communityName}</span> — enjoy the conversation.</>
          ) : requested ? (
            <>Request sent to join <span className="font-medium text-foreground">{communityName}</span> — waiting for the owner&apos;s approval.</>
          ) : (
            <>This post was shared by <span className="font-medium text-foreground">{communityName}</span>.</>
          )}
        </p>
      </div>

      {joined ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1.5 font-body text-xs font-medium text-accent">
          <Check strokeWidth={2.5} size={12} />
          Joined
        </span>
      ) : requested ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
          <Lock strokeWidth={2.5} size={11} />
          Request pending
        </span>
      ) : canJoin ? (
        <button
          type="button"
          onClick={() => void handleJoin()}
          disabled={joining}
          className="shrink-0 rounded-lg bg-accent px-3.5 py-1.5 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {joining ? "Joining…" : isPrivate ? "Request to join" : `Join ${communityName}`}
        </button>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-body text-xs text-foreground-muted">
          <Lock strokeWidth={2.5} size={11} />
          {isPrivate ? "Private community" : "Update your profile to join"}
        </span>
      )}
      {error && (
        <p role="alert" className="w-full font-body text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
