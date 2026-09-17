"use client";

/**
 * CommunityRightSidebar
 *
 * Floating info card on the right of every community page: the community's
 * identity (DP, name, member count, membership check) with the live member
 * avatars, a Community Overview (creator / created / category / tags), a
 * Create Post action, the description, the numbered Community Rules and a
 * Member Role breakdown. Lives in the communities layout so it persists across
 * chat, threads, events, resources and detail routes.
 *
 * Data strategy mirrors CommunityPageShell: pre-seed from the shared
 * metaCache, fall back to the sidebarStore for a fast first paint, then fetch
 * /api/communities/[id] once (deduped through inFlightMetaFetch) — that read
 * model also carries the owner and the per-role member totals. Rules use the
 * cached rules endpoint and stay live via the realtime rules room.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Check, ChevronRight, Info, Plus } from "lucide-react";
import {
  metaCache,
  inFlightMetaFetch,
  META_STALE_MS,
  sidebarStore,
  type CachedMeta,
} from "@/lib/communities/cache";
import { fetchJsonCached, patchCachedRequest } from "@/lib/request-cache";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { publishContentChange } from "@/lib/communities/content-sync";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CommunityDp } from "./CommunityDp";
import { CreateThreadModal } from "./threads/CreateThreadModal";
import type { CommunityThread } from "./threads/types";
import { useOnlinePresence } from "./chat/useOnlinePresence";

type Community = CachedMeta["community"] & {
  reference_name?: string | null;
};
type Member = CachedMeta["members"][number];

interface CommunityRule {
  id: string;
  rule_text: string;
  order_index: number;
}

const TYPE_LABELS: Record<string, string> = {
  city: "City",
  sector: "Industry",
  interest: "Interest",
  experience_level: "Experience",
  job_title: "Job Title",
  general: "General",
  user: "Member-led",
};

const MAX_AVATARS = 6;

/** Description length above which the panel offers "Read more". */
const DESCRIPTION_CLAMP_LENGTH = 180;

function fallbackDescription(type?: string, referenceName?: string | null): string {
  const name = referenceName ?? "this topic";
  switch (type) {
    case "city":
      return `Connect with designers based in ${name}.`;
    case "sector":
      return `A community for designers in the ${name} industry.`;
    case "interest":
      return `Designers who share a passion for ${name}.`;
    case "experience_level":
      return `A space for ${name} designers to connect and share.`;
    case "job_title":
      return `Connect with fellow ${name}s and share your work.`;
    case "general":
      return "The default community for every UX Community designer.";
    case "user":
      return "A member-created community on UX Community.";
    default:
      return "A designer community on UX Community.";
  }
}

function fmtCreatedAt(iso?: string | null): string {
  if (!iso) return "—";
  // Same locale as the sidebar/chat timestamps (en-US) — en-IN read
  // day-month-year while every other date in the product read month-day-year.
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function memberLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "member" : "members"}`;
}

// ─── Data hooks ────────────────────────────────────────────────────────────────

function useCommunityMeta(communityId: string | null) {
  const [community, setCommunity] = useState<Community | null>(() => {
    if (!communityId) return null;
    const cached = metaCache.get(communityId);
    if (cached) return cached.community as Community;
    const sidebarEntry = sidebarStore.data?.communities.find((c) => c.id === communityId);
    return sidebarEntry
      ? {
          id: sidebarEntry.id,
          name: sidebarEntry.name,
          type: sidebarEntry.type,
          member_count: sidebarEntry.member_count,
          image_url: sidebarEntry.image_url,
          reference_name: sidebarEntry.reference_name ?? null,
          created_at: sidebarEntry.created_at ?? undefined,
        }
      : null;
  });
  const [members, setMembers] = useState<Member[]>(
    () => (communityId ? metaCache.get(communityId)?.members ?? [] : []),
  );

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;

    const applyCached = () => {
      const fresh = metaCache.get(communityId);
      if (fresh && !cancelled) {
        setCommunity(fresh.community as Community);
        setMembers(fresh.members);
      }
    };

    const cached = metaCache.get(communityId);
    if (cached) {
      applyCached();
      if (Date.now() - cached.fetchedAt < META_STALE_MS) return;
    } else {
      const sidebarEntry = sidebarStore.data?.communities.find((c) => c.id === communityId);
      setCommunity(
        sidebarEntry
          ? {
              id: sidebarEntry.id,
              name: sidebarEntry.name,
              type: sidebarEntry.type,
              member_count: sidebarEntry.member_count,
              image_url: sidebarEntry.image_url,
              reference_name: sidebarEntry.reference_name ?? null,
              created_at: sidebarEntry.created_at ?? undefined,
            }
          : null,
      );
      setMembers([]);
    }

    const existing = inFlightMetaFetch.get(communityId);
    if (existing) {
      existing.then(applyCached);
      return () => {
        cancelled = true;
      };
    }

    const promise = fetch(`/api/communities/${communityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { community: Community; members: Member[] } | null) => {
        if (!data) return;
        metaCache.set(communityId, {
          community: data.community,
          members: data.members,
          fetchedAt: Date.now(),
        });
        applyCached();
      })
      .catch(() => {})
      .finally(() => {
        inFlightMetaFetch.delete(communityId);
      });
    inFlightMetaFetch.set(communityId, promise);

    return () => {
      cancelled = true;
    };
  }, [communityId]);

  return { community, members };
}

function useCommunityRules(communityId: string | null, currentUserId: string) {
  const [rules, setRules] = useState<CommunityRule[]>([]);
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    setRules([]);

    fetchJsonCached<{ rules: CommunityRule[] }>(
      `/api/communities/${communityId}/rules`,
      { staleMs: 60_000 },
      currentUserId,
    )
      .then((data) => {
        if (data?.rules && !cancelled) setRules(data.rules);
      })
      .catch(() => {});

    if (!isVisible || !currentUserId) {
      return () => {
        cancelled = true;
      };
    }

    const rulesRoom = realtimeRooms.rules(communityId);
    const unsubRules = realtimeClient.on(rulesRoom, "rule", (data) => {
      const { event, rule } = data as { event?: string; rule: CommunityRule };
      const updateRules = (previous: CommunityRule[]) => {
        if (event === "INSERT") {
          if (previous.some((item) => item.id === rule.id)) return previous;
          return [...previous, rule].sort((a, b) => a.order_index - b.order_index);
        }
        if (event === "UPDATE") {
          return previous
            .map((item) => (item.id === rule.id ? rule : item))
            .sort((a, b) => a.order_index - b.order_index);
        }
        return previous.filter((item) => item.id !== rule.id);
      };
      setRules(updateRules);
      patchCachedRequest<{ rules: CommunityRule[] }>(
        `/api/communities/${communityId}/rules`,
        (current) => ({ ...current, rules: updateRules(current.rules) }),
        currentUserId,
      );
    });
    const unsubRoom = realtimeClient.subscribe(rulesRoom);
    realtimeClient.connect();

    return () => {
      cancelled = true;
      unsubRules();
      unsubRoom();
    };
  }, [communityId, currentUserId, isVisible]);

  return rules;
}

// ─── Small presentational pieces ───────────────────────────────────────────────

/** One label/value line in Community Overview. */
function OverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 font-body text-[13px] text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-right font-body text-[13px] font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Skeleton bar used while the community read model is still in flight. */
function SkeletonLine({ className }: { className: string }) {
  return <span className={`block rounded bg-surface-raised animate-pulse ${className}`} />;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
}

export function CommunityRightSidebar({ currentUserId }: Props) {
  const params = useParams<{ id?: string }>();
  const communityId = typeof params?.id === "string" ? params.id : null;
  const router = useGuardedRouter();

  const { community, members } = useCommunityMeta(communityId);
  const rules = useCommunityRules(communityId, currentUserId);
  const { onlineCount } = useOnlinePresence({
    communityId: communityId ?? "",
    currentUserId,
  });

  const [composing, setComposing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Explore page and other non-community routes: no sidebar.
  if (!communityId) return null;

  const type = community?.type;
  const referenceName = community?.reference_name ?? null;
  const description = community?.description ?? fallbackDescription(type, referenceName);
  const memberCount = community?.member_count ?? members.length;
  const owner = community?.owner ?? null;
  const roleCounts = community?.role_counts ?? null;
  const visibleMembers = members.slice(0, MAX_AVATARS);
  const overflow = Math.max(0, memberCount - visibleMembers.length);
  const category = type ? TYPE_LABELS[type] ?? "Community" : "Community";

  // The schema has no community tags; the master-data name behind a community
  // is the only extra label it carries, and only when it differs from the
  // community's name (a renamed interest community keeps its original topic).
  const tagPills = referenceName && referenceName.toLowerCase() !== (community?.name ?? "").trim().toLowerCase()
    ? [referenceName]
    : [];
  const longDescription = description.length > DESCRIPTION_CLAMP_LENGTH;

  const roleRows = [
    {
      key: "member",
      label: "Member",
      hint: "Everyone who has joined this community.",
      count: roleCounts?.member ?? 0,
    },
    {
      key: "admin",
      label: "Admin",
      hint: "Appointed to help run the community.",
      count: roleCounts?.admin ?? 0,
    },
    {
      key: "owner",
      label: "Owner",
      hint: "Created the community and manages its settings.",
      count: roleCounts?.owner ?? 0,
    },
  ].filter((row) => row.count > 0);

  function handleThreadCreated(thread: CommunityThread) {
    // Same announcement the Threads tab makes, so the homepage and profile
    // feeds pick the new post up instead of waiting for their next refetch.
    publishContentChange({ kind: "thread", id: thread.id, created: true });
    setComposing(false);
    router.push(`/dashboard/communities/${communityId}/threads/${thread.id}`);
  }

  return (
    <aside
      aria-label="Community details"
      className="hidden xl:flex w-80 shrink-0 flex-col overflow-y-auto p-3 pl-0"
    >
      <div className="rounded-2xl border border-border bg-background">
        {/* ── Identity ────────────────────────────────────────────────── */}
        <section aria-labelledby="sidebar-community-heading" className="px-5 py-5">
          <div className="flex items-start gap-3">
            <CommunityDp
              imageUrl={community?.image_url ?? null}
              name={community?.name ?? "Community"}
              size={48}
              className="bg-surface-raised"
            />

            <div className="min-w-0 flex-1">
              <h2
                id="sidebar-community-heading"
                className="truncate font-display text-[17px] font-semibold leading-tight text-foreground"
              >
                {community?.name ?? "Community"}
              </h2>
              <Link
                href={`/dashboard/communities/${communityId}?tab=members`}
                className="mt-1 inline-flex items-center gap-0.5 font-body text-[13px] text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {memberLabel(memberCount)}
                <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
              </Link>
            </div>

            {/* Membership check — every viewer of this panel is a member. */}
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
              aria-label="You are a member of this community"
              title="You're a member"
            >
              <Check size={14} strokeWidth={3} aria-hidden="true" />
            </span>
          </div>

          {/* Live members: avatar stack + who's online right now. */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {visibleMembers.length > 0 ? (
              <ul className="flex min-w-0 items-center" aria-label="Recent members">
                {visibleMembers.map((member, index) => (
                  <li
                    key={member.user_id}
                    className={`relative rounded-full ring-2 ring-background ${index > 0 ? "-ml-2.5" : ""}`}
                    style={{ zIndex: visibleMembers.length - index }}
                    title={member.users?.name ?? "Member"}
                  >
                    <AvatarImg
                      url={member.users?.avatar_url}
                      name={member.users?.name ?? "Member"}
                      size={36}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  </li>
                ))}
                {overflow > 0 && (
                  <li
                    className="relative -ml-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised ring-2 ring-background font-body text-[11px] font-semibold text-foreground-muted"
                    aria-label={`${overflow} more members`}
                  >
                    +{overflow}
                  </li>
                )}
              </ul>
            ) : (
              <div className="flex items-center" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-9 w-9 rounded-full bg-surface-raised ring-2 ring-background animate-pulse ${index > 0 ? "-ml-2.5" : ""}`}
                  />
                ))}
              </div>
            )}

            <span
              className="inline-flex shrink-0 items-center gap-1.5 font-body text-xs text-foreground-muted"
              aria-label={`${onlineCount} online`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              {onlineCount} online
            </span>
          </div>
        </section>

        {/* ── Community Overview ──────────────────────────────────────── */}
        <section
          aria-labelledby="sidebar-overview-heading"
          className="border-t border-border px-5 py-5"
        >
          <h2
            id="sidebar-overview-heading"
            className="font-display text-[15px] font-semibold text-foreground"
          >
            Community Overview
          </h2>
          {community ? (
            <dl className="mt-2 flex flex-col">
              {owner && (
                <OverviewRow label="Creator">
                  <span className="flex items-center justify-end gap-2">
                    <AvatarImg
                      url={owner.avatar_url}
                      name={owner.name}
                      size={20}
                      className="h-5 w-5 shrink-0 rounded-full object-cover"
                    />
                    <span className="truncate">{owner.name}</span>
                  </span>
                </OverviewRow>
              )}
              <OverviewRow label="Date created">{fmtCreatedAt(community.created_at)}</OverviewRow>
              <OverviewRow label="Category">{category}</OverviewRow>
              {tagPills.length > 0 && (
                <OverviewRow label="Tags">
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {tagPills.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-border px-2 py-0.5 font-body text-[11px] font-normal text-foreground-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </OverviewRow>
              )}
            </dl>
          ) : (
            <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
              <SkeletonLine className="h-3.5 w-full" />
              <SkeletonLine className="h-3.5 w-11/12" />
              <SkeletonLine className="h-3.5 w-2/3" />
            </div>
          )}
        </section>

        {/* ── Create Post ─────────────────────────────────────────────── */}
        <section className="border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Create Post
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </section>

        {/* ── Description ─────────────────────────────────────────────── */}
        <section
          aria-labelledby="sidebar-description-heading"
          className="border-t border-border px-5 py-5"
        >
          <h2
            id="sidebar-description-heading"
            className="font-display text-[15px] font-semibold text-foreground"
          >
            Description
          </h2>
          <p
            className={`mt-3 font-body text-sm leading-relaxed text-foreground-muted ${
              longDescription && !descriptionExpanded ? "line-clamp-3" : ""
            }`}
          >
            {community ? description : <SkeletonLine className="h-3.5 w-full" />}
          </p>
          {community && longDescription && (
            <button
              type="button"
              onClick={() => setDescriptionExpanded((previous) => !previous)}
              aria-expanded={descriptionExpanded}
              className="mt-1.5 font-body text-sm font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {descriptionExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </section>

        {/* ── Community Rules ─────────────────────────────────────────── */}
        <section
          aria-labelledby="sidebar-rules-heading"
          className="border-t border-border px-5 py-5"
        >
          <h2
            id="sidebar-rules-heading"
            className="font-display text-[15px] font-semibold text-foreground"
          >
            Community Rules
          </h2>
          {rules.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-3">
              {rules.map((rule, index) => (
                <li key={rule.id} className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-xs font-semibold text-foreground-muted">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 font-body text-sm leading-relaxed text-foreground-muted">
                    {rule.rule_text}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 font-body text-sm text-foreground-muted">
              No community rules have been added yet.
            </p>
          )}
        </section>

        {/* ── Member Role ─────────────────────────────────────────────── */}
        {roleRows.length > 0 && (
          <section
            aria-labelledby="sidebar-roles-heading"
            className="border-t border-border px-5 py-5"
          >
            <h2
              id="sidebar-roles-heading"
              className="font-display text-[15px] font-semibold text-foreground"
            >
              Member Role
            </h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {roleRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="rounded-md border border-border px-2 py-1 font-body text-[11px] text-foreground-muted">
                      {row.label}
                    </span>
                    <span
                      role="img"
                      aria-label={row.hint}
                      title={row.hint}
                      className="flex shrink-0 items-center text-foreground-subtle"
                    >
                      <Info size={12} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="shrink-0 font-body text-[13px] text-foreground">
                    {memberLabel(row.count)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {composing && (
        <CreateThreadModal
          communityId={communityId}
          name={community?.name}
          avatarUrl={community?.image_url ?? null}
          onClose={() => setComposing(false)}
          onCreated={handleThreadCreated}
        />
      )}
    </aside>
  );
}
