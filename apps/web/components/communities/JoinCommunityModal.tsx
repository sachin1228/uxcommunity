"use client";

import { useState } from "react";
import { CheckCircle2, Lock, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { CommunityDp } from "./CommunityDp";
import { CommunityNameBadges } from "./CommunityBadges";

/** The facts the community dialog renders — a subset of the Explore list's row. */
export interface JoinableCommunity {
  id: string;
  name: string;
  type: string;
  is_private?: boolean | null;
  image_url: string | null;
  description: string | null;
  member_count: number;
}

/**
 * The one community dialog, everywhere a community is introduced and joined.
 *
 * Explore's join buttons, the home feed's "posted in …" popup, the Suggested
 * Communities rail and the community page's non-member preview all render this
 * body, so the design can never drift between surfaces: a centered identity
 * header, the admin-written about (public) or the private notice, and one
 * primary action with an optional Cancel.
 *
 * The states, in order:
 *   - member   → "you're already a member" — a statement, nothing to click.
 *   - requested→ the "Request sent — we'll notify you" confirmation.
 *   - closed   → a profile-gated notice (no action that cannot work).
 *   - open     → Join community (public) or Request to join (private).
 *
 * The network call lives here so every caller only reacts to the outcome;
 * errors stay inside the dialog.
 */
export function CommunityJoinDialog({
  community,
  joined = false,
  canJoin = true,
  hasPendingRequest = false,
  onClose,
  onJoined,
  onRequested,
}: {
  community: JoinableCommunity;
  /** The viewer already belongs — the dialog says so and nothing else. */
  joined?: boolean;
  /** False when the community is closed to this profile — a notice, no action. */
  canJoin?: boolean;
  /** True when the viewer already has a pending request for it. */
  hasPendingRequest?: boolean;
  /** Closes the dialog. Omitted on the non-modal (page) surface, which hides Cancel. */
  onClose?: () => void;
  /** Membership granted — the caller opens the community chat. */
  onJoined?: (communityId: string) => void;
  /** A private request was recorded — the caller persists the pending state. */
  onRequested?: (communityId: string) => void;
}) {
  const isPrivate = community.is_private === true;
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState(hasPendingRequest);
  const [joinedNow, setJoinedNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMember = joined || joinedNow;
  const memberCount = community.member_count.toLocaleString();

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await dedupeFetch(`/api/communities/${community.id}/join`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (data.status === "requested") {
        setRequested(true);
        onRequested?.(community.id);
      } else {
        setJoinedNow(true);
        onJoined?.(community.id);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const cancelButton = onClose ? (
    <button
      type="button"
      onClick={onClose}
      disabled={submitting}
      className="w-full rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
    >
      Cancel
    </button>
  ) : null;

  return (
    <>
      {/* ── Who you're joining ── */}
      <div className="flex flex-col items-center text-center">
        <CommunityDp
          imageUrl={community.image_url}
          name={community.name}
          size={64}
          className="bg-surface-raised"
        />
        <h2 className="mt-3 flex items-center justify-center gap-1.5 font-display text-lg font-semibold text-foreground">
          <span className="min-w-0 truncate">{community.name}</span>
          <CommunityNameBadges
            type={community.type}
            isPrivate={community.is_private}
            size={13}
          />
        </h2>
        <p className="mt-1 inline-flex items-center gap-1 font-body text-xs text-foreground-muted">
          <Users size={12} strokeWidth={2.5} aria-hidden="true" />
          {memberCount} member{community.member_count === 1 ? "" : "s"}
        </p>
      </div>

      {isMember ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
          <CheckCircle2
            size={14}
            strokeWidth={2.5}
            className="mt-0.5 shrink-0 text-accent"
            aria-hidden="true"
          />
          <p className="font-body text-xs leading-relaxed text-foreground-muted">
            You&apos;re already a member of this community.
          </p>
        </div>
      ) : requested ? (
        <div className="mt-6 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CheckCircle2 size={22} strokeWidth={2.5} aria-hidden="true" />
          </span>
          <p className="mt-3 font-display text-base font-semibold text-foreground">
            Request sent
          </p>
          <p className="mt-1 max-w-xs font-body text-sm leading-relaxed text-foreground-muted">
            Your request to join {community.name} has been sent. We&apos;ll notify
            you once an owner accepts it.
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Done
            </button>
          )}
        </div>
      ) : !canJoin ? (
        <>
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
            <Lock
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0 text-foreground-subtle"
              aria-hidden="true"
            />
            <p className="font-body text-xs leading-relaxed text-foreground-muted">
              An official community built from member profiles — only members
              whose profile matches can join.{" "}
              {isPrivate
                ? "Update your profile to match, then request to join."
                : "Update your profile to match and you'll join automatically."}
            </p>
          </div>
          {onClose && (
            <div className="mt-6">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Close
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {community.description && (
            <div className="mt-6">
              <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                About
              </p>
              <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-body text-sm leading-relaxed text-foreground-muted">
                {community.description}
              </p>
            </div>
          )}

          {isPrivate && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
              <Lock
                size={14}
                strokeWidth={2.5}
                className="mt-0.5 shrink-0 text-foreground-subtle"
                aria-hidden="true"
              />
              <p className="font-body text-xs leading-relaxed text-foreground-muted">
                This is a private community. You&apos;ll need to request to join —
                an owner or admin reviews every request before you can enter.
              </p>
            </div>
          )}

          {error && <p className="mt-3 font-body text-xs text-red-400">{error}</p>}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              {isPrivate
                ? submitting
                  ? "Sending…"
                  : "Request to join"
                : submitting
                  ? "Joining…"
                  : "Join community"}
            </button>
            {cancelButton}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The dialog inside a Modal. Explore's join buttons and the Suggested
 * Communities rail use this; the home-feed popup and the community page render
 * the same body through their own surface.
 */
export function JoinCommunityModal({
  community,
  onClose,
  onJoined,
  onRequested,
}: {
  community: JoinableCommunity;
  onClose: () => void;
  onJoined: (communityId: string) => void;
  onRequested: (communityId: string) => void;
}) {
  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" panelClassName="p-6">
      <CommunityJoinDialog
        community={community}
        onClose={onClose}
        onJoined={onJoined}
        onRequested={onRequested}
      />
    </Modal>
  );
}
