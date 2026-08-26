"use client";

import { useEffect, useState } from "react";
import { Calendar, MapPin } from "lucide-react";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { fetchJsonCached, patchCachedRequest } from "@/lib/request-cache";

interface CommunityData {
  member_count: number;
  type?: string;
  description?: string | null;
  reference_name?: string | null;
  created_at?: string;
}

interface CommunityInfoPanelProps {
  community: CommunityData | null;
  communityId: string;
  currentUserId?: string;
  onlineCount?: number;
}

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

function fmtCreatedAt(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CommunityInfoPanel({
  community,
  communityId,
  currentUserId,
  onlineCount = 0,
}: CommunityInfoPanelProps) {
  const [postsToday, setPostsToday] = useState<number | null>(null);
  const [rules, setRules] = useState<CommunityRule[]>([]);
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!communityId) return;

    fetchJsonCached<{ posts_today: number }>(
      `/api/communities/${communityId}/stats`,
      { staleMs: 60_000 },
      currentUserId,
    )
      .then((data) => {
        if (data != null) setPostsToday(data.posts_today);
      })
      .catch(() => {});

    fetchJsonCached<{ rules: CommunityRule[] }>(
      `/api/communities/${communityId}/rules`,
      { staleMs: 60_000 },
      currentUserId,
    )
      .then((data) => {
        if (data?.rules) setRules(data.rules);
      })
      .catch(() => {});

    if (!isVisible || !currentUserId) return;
    const rulesClient = new RealtimeClient({
      room: realtimeRooms.rules(communityId),
      user: { id: currentUserId, name: null, avatar: null },
    });
    const unsubRules = rulesClient.on("rule", (data) => {
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
    rulesClient.connect();

    return () => {
      unsubRules();
      rulesClient.close();
    };
  }, [communityId, currentUserId, isVisible]);

  const type = community?.type;
  const referenceName = community?.reference_name ?? null;
  const description =
    community?.description ?? fallbackDescription(type, referenceName);
  const tags = [
    ...(type ? [TYPE_LABELS[type] ?? type] : []),
    ...(referenceName ? [referenceName] : []),
  ];
  const stats = [
    { label: "Members", value: (community?.member_count ?? 0).toLocaleString() },
    { label: "Online", value: onlineCount.toLocaleString() },
    {
      label: "Messages",
      value: postsToday != null ? postsToday.toLocaleString() : "—",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 md:px-8 md:py-8">
        <section aria-labelledby="community-about-heading">
          <h2
            id="community-about-heading"
            className="font-display text-xl font-semibold text-foreground"
          >
            About
          </h2>
          <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-foreground-muted">
            {description}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {type === "city" && referenceName && (
              <div className="flex items-center gap-2 font-body text-sm text-foreground-muted">
                <MapPin size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
                {referenceName}
              </div>
            )}
            <div className="flex items-center gap-2 font-body text-sm text-foreground-muted">
              <Calendar size={16} className="shrink-0 text-foreground-subtle" aria-hidden="true" />
              Created {fmtCreatedAt(community?.created_at)}
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
        </section>

        <section aria-labelledby="community-stats-heading" className="border-t border-border pt-6">
          <h2
            id="community-stats-heading"
            className="font-display text-base font-semibold text-foreground"
          >
            Community Stats
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stats.map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-surface-raised p-4">
                <dd className="font-display text-xl font-bold text-foreground">{value}</dd>
                <dt className="mt-1 font-body text-xs text-foreground-muted">{label}</dt>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="community-rules-heading" className="border-t border-border pt-6">
          <h2
            id="community-rules-heading"
            className="font-display text-base font-semibold text-foreground"
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
    </div>
  );
}
