"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Clock, Lock, MessageCircle, MessagesSquare, Sparkles } from "lucide-react";
import { CommunityDp } from "./CommunityDp";
import { CommunityNameBadges } from "./CommunityBadges";
import { JoinCommunityModal } from "./JoinCommunityModal";

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

/**
 * The shared body of the community preview — the exact card the community
 * page renders full-page (wrapped in CommunityPreview below), the homepage's
 * "posted in …" modal, and the profile activity tabs.
 *
 * The join / request action is the same JoinCommunityModal the Explore page
 * uses, so every place a member can join a community behaves identically: the
 * dialog carries the community's own about, joins open communities straight
 * into the group chat, and files a request (with a "we'll notify you"
 * confirmation) for private ones.
 *
 * The action row depends on the viewer: members get a plain "View community"
 * link, a pending request gets its waiting row, and a community this member's
 * profile cannot join stays a closed row rather than a button that cannot
 * work.
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
  const router = useRouter();
  const pathname = usePathname();
  const [localJoined, setLocalJoined] = useState(false);
  const [requested, setRequested] = useState(hasPendingRequest);
  const [joinOpen, setJoinOpen] = useState(false);

  const isMember = joined || localJoined;

  const publicBits = [
    publicCounts.threads ? { icon: MessagesSquare, label: `${publicCounts.threads} public thread${publicCounts.threads === 1 ? "" : "s"}` } : null,
    publicCounts.events ? { icon: MessageCircle, label: `${publicCounts.events} public event${publicCounts.events === 1 ? "" : "s"}` } : null,
    publicCounts.showcase ? { icon: Sparkles, label: `${publicCounts.showcase} public showcase post${publicCounts.showcase === 1 ? "" : "s"}` } : null,
  ].filter((bit): bit is { icon: typeof MessageCircle; label: string } => bit !== null);

  function openCommunity() {
    router.push(`/dashboard/communities/${communityId}`);
  }

  function handleJoined() {
    setLocalJoined(true);
    setJoinOpen(false);
    // Joining lands the member in the group chat. When this card IS that
    // community's non-member page, the URL is already the destination — a push
    // there would be a no-op, so refresh instead and the server renders the chat.
    const target = `/dashboard/communities/${communityId}`;
    if (pathname === target) router.refresh();
    else router.push(target);
  }

  function handleRequested() {
    setRequested(true);
  }

  return (
    <>
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
            <ViewCommunityRow onClick={openCommunity} />
          ) : requested ? (
            <RequestPendingRow />
          ) : !canJoin ? (
            <ClosedRow isPrivate={isPrivate} />
          ) : (
            <button
              type="button"
              onClick={() => setJoinOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {isPrivate ? (
                <>
                  <Lock strokeWidth={2.5} size={13} />
                  Request to join
                </>
              ) : (
                "Join community"
              )}
            </button>
          )}
          {footerNote && (
            <p className="font-body text-xs text-foreground-subtle">{footerNote}</p>
          )}
        </div>
      </div>

      {joinOpen && (
        <JoinCommunityModal
          community={{
            id: communityId,
            name,
            type,
            is_private: isPrivate,
            image_url: imageUrl,
            description,
            member_count: memberCount,
          }}
          onClose={() => setJoinOpen(false)}
          onJoined={handleJoined}
          onRequested={handleRequested}
        />
      )}
    </>
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
 * derived types their profile does not match), which keeps the action a closed
 * row instead of a button that cannot work. A community that has been deleted
 * never reaches this component — the page falls through to "Community not
 * found", and the home-feed popup shows its own deleted state.
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
