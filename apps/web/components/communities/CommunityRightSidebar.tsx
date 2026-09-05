"use client";

/**
 * CommunityRightSidebar
 *
 * Floating info card on the right of every community page: member avatar
 * stack + online count, About (description / created date / type tag) and the
 * numbered Rules list. Lives in the communities layout so it persists across
 * chat, threads, events, resources and detail routes.
 *
 * Data strategy mirrors CommunityPageShell: pre-seed from the shared
 * metaCache, fall back to the sidebarStore for a fast first paint, then fetch
 * /api/communities/[id] once (deduped through inFlightMetaFetch). Rules use the
 * cached rules endpoint and stay live via the realtime rules room.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar, MapPin } from "lucide-react";
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
import { AvatarImg } from "@/components/ui/AvatarImg";
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
};

const MAX_AVATARS = 6;

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
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
}

export function CommunityRightSidebar({ currentUserId }: Props) {
  const params = useParams<{ id?: string }>();
  const communityId = typeof params?.id === "string" ? params.id : null;

  const { community, members } = useCommunityMeta(communityId);
  const rules = useCommunityRules(communityId, currentUserId);
  const { onlineCount } = useOnlinePresence({
    communityId: communityId ?? "",
    currentUserId,
  });

  // Explore page and other non-community routes: no sidebar.
  if (!communityId) return null;

  const type = community?.type;
  const referenceName = community?.reference_name ?? null;
  const description = community?.description ?? fallbackDescription(type, referenceName);
  const memberCount = community?.member_count ?? members.length;
  const visibleMembers = members.slice(0, MAX_AVATARS);
  const overflow = Math.max(0, memberCount - visibleMembers.length);
  const tags = [
    ...(type ? [TYPE_LABELS[type] ?? null] : []),
    ...(referenceName ? [referenceName] : []),
  ].filter((tag): tag is string => Boolean(tag));

  return (
    <aside
      aria-label="Community details"
      className="hidden xl:flex w-80 shrink-0 flex-col overflow-y-auto p-3 pl-0"
    >
      <div className="rounded-2xl border border-border bg-background">
        {/* ── Members ─────────────────────────────────────────────────── */}
        <section aria-labelledby="sidebar-members-heading" className="px-5 py-5">
          <div className="flex items-center justify-between">
            <h2
              id="sidebar-members-heading"
              className="font-display text-[15px] font-semibold text-foreground"
            >
              Members{community ? ` (${memberCount})` : ""}
            </h2>
            <span
              className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-muted"
              aria-label={`${onlineCount} online`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              {onlineCount} online
            </span>
          </div>

          <div className="mt-4 flex items-center">
            {visibleMembers.length > 0 ? (
              <ul className="flex items-center" aria-label="Recent members">
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
                {Array.from({ length: 5 }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-9 w-9 rounded-full bg-surface-raised ring-2 ring-background animate-pulse ${index > 0 ? "-ml-2.5" : ""}`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── About ───────────────────────────────────────────────────── */}
        <section
          aria-labelledby="sidebar-about-heading"
          className="border-t border-border px-5 py-5"
        >
          <h2
            id="sidebar-about-heading"
            className="font-display text-[15px] font-semibold text-foreground"
          >
            About
          </h2>
          {community ? (
            <>
              <p className="mt-3 font-body text-sm leading-relaxed text-foreground-muted">
                {description}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {type === "city" && referenceName && (
                  <div className="flex items-center gap-2 font-body text-sm text-foreground-muted">
                    <MapPin strokeWidth={2.5} size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                    {referenceName}
                  </div>
                )}
                <div className="flex items-center gap-2 font-body text-sm text-foreground-muted">
                  <Calendar strokeWidth={2.5} size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                  Created {fmtCreatedAt(community.created_at)}
                </div>
              </div>
              {tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border px-3 py-1 font-body text-xs text-foreground-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
              <span className="h-3.5 w-full rounded bg-surface-raised animate-pulse" />
              <span className="h-3.5 w-11/12 rounded bg-surface-raised animate-pulse" />
              <span className="h-3.5 w-2/3 rounded bg-surface-raised animate-pulse" />
            </div>
          )}
        </section>

        {/* ── Rules ───────────────────────────────────────────────────── */}
        <section
          aria-labelledby="sidebar-rules-heading"
          className="border-t border-border px-5 py-5"
        >
          <h2
            id="sidebar-rules-heading"
            className="font-display text-[15px] font-semibold text-foreground"
          >
            Rules
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
      </div>
    </aside>
  );
}
