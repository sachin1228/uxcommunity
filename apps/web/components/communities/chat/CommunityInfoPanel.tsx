"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MapPin,
  Calendar,
  Users,
  ExternalLink,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";

interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

interface UpcomingEvent {
  id: string;
  title: string;
  event_date: string;
  location: string | null;
  is_online: boolean;
  rsvp_count: number;
}

interface CommunityData {
  member_count: number;
  type?: string;
  description?: string | null;
  reference_name?: string | null;
  created_at?: string;
}

interface CommunityInfoPanelProps {
  members: Member[];
  community: CommunityData | null;
  communityId: string;
  onlineCount?: number;
}

const TYPE_LABELS: Record<string, string> = {
  city:             "City",
  sector:           "Industry",
  interest:         "Interest",
  company:          "Company",
  experience_level: "Experience",
};

function fallbackDescription(type?: string, referenceName?: string | null): string {
  const name = referenceName ?? "this topic";
  switch (type) {
    case "city":             return `Connect with designers based in ${name}.`;
    case "company":          return `A space for designers working at ${name} to connect and grow together.`;
    case "sector":           return `A community for designers in the ${name} industry.`;
    case "interest":         return `Designers who share a passion for ${name}.`;
    case "experience_level": return `A space for ${name} designers to connect and share.`;
    default:                 return "A designer community on Drafthub.";
  }
}

function fmtCreatedAt(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtEventDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  return `${date} · ${time}`;
}

// ─── Avatar stack ─────────────────────────────────────────────────────────────
function AvatarStack({ members, total }: { members: Member[]; total: number }) {
  const shown = members.slice(0, 7);
  const extra = total > shown.length ? total - shown.length : 0;

  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <div
          key={m.user_id}
          className="ring-2 ring-surface rounded-full shrink-0"
          style={{ marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i }}
        >
          <ChatAvatar
            name={m.users?.name ?? "?"}
            url={m.users?.avatar_url ?? null}
            size={7}
          />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="h-7 w-7 shrink-0 rounded-full bg-surface-raised ring-2 ring-surface flex items-center justify-center font-body text-[10px] font-semibold text-foreground-muted"
          style={{ marginLeft: -10 }}
        >
          {extra >= 1000 ? `+${Math.round(extra / 1000)}K` : `+${extra}`}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper — plain divider, no individual card ─────────────────────
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between mb-3">
        <span className="font-body text-sm font-semibold text-foreground">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function SeeAll() {
  return (
    <button className="font-body text-xs text-accent hover:underline">
      See all
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CommunityInfoPanel({ members, community, communityId, onlineCount = 0 }: CommunityInfoPanelProps) {
  const memberCount = community?.member_count ?? members.length;

  const [upcomingEvent, setUpcomingEvent] = useState<UpcomingEvent | null>(null);
  const [postsToday, setPostsToday] = useState<number | null>(null);

  useEffect(() => {
    if (!communityId) return;
    fetch(`/api/communities/${communityId}/events`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { events: UpcomingEvent[] } | null) => {
        if (!data?.events?.length) return;
        const now = new Date();
        const upcoming = data.events
          .filter((e) => new Date(e.event_date) > now)
          .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        setUpcomingEvent(upcoming[0] ?? null);
      })
      .catch(() => {/* silent */});

    fetch(`/api/communities/${communityId}/stats`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { posts_today: number } | null) => {
        if (data != null) setPostsToday(data.posts_today);
      })
      .catch(() => {/* silent */});
  }, [communityId]);

  return (
    // Outer wrapper — sizing + scroll, holds both cards
    <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">

      {/* Main info card */}
      <div className="border border-border mr-4 mt-4 rounded-xl flex flex-col">

        {/* Members */}
        <Section
          title={`Members (${memberCount.toLocaleString()})`}
          action={<SeeAll />}
        >
          <AvatarStack members={members} total={memberCount} />
        </Section>

        {/* About */}
        {(() => {
          const type = community?.type;
          const refName = community?.reference_name ?? null;
          const description = community?.description
            ?? fallbackDescription(type, refName);
          const tags: string[] = [
            ...(type ? [TYPE_LABELS[type] ?? type] : []),
            ...(refName ? [refName] : []),
          ];
          return (
            <Section title="About">
              <p className="font-body text-[13px] text-foreground-muted leading-relaxed mb-3">
                {description}
              </p>
              <div className="space-y-2 mb-3">
                {type === "city" && refName && (
                  <div className="flex items-center gap-2 font-body text-[13px] text-foreground-muted">
                    <MapPin size={13} className="shrink-0 text-foreground-subtle" />
                    {refName}
                  </div>
                )}
                <div className="flex items-center gap-2 font-body text-[13px] text-foreground-muted">
                  <Calendar size={13} className="shrink-0 text-foreground-subtle" />
                  Created {fmtCreatedAt(community?.created_at)}
                </div>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 rounded-full border border-border font-body text-[12px] text-foreground-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          );
        })()}

        {/* Upcoming Events — only shown when a real upcoming event exists */}
        {upcomingEvent && (
          <Section title="Upcoming Events" action={<SeeAll />}>
            <div className="flex gap-3">
              <div className="w-16 h-16 rounded-lg bg-surface-raised shrink-0 flex items-center justify-center overflow-hidden border border-border">
                <Calendar size={20} className="text-foreground-subtle" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-[13px] font-semibold text-foreground leading-snug mb-1">
                  {upcomingEvent.title}
                </p>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                    <Calendar size={11} className="shrink-0" />
                    {fmtEventDate(upcomingEvent.event_date)}
                  </div>
                  {upcomingEvent.location && (
                    <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                      <MapPin size={11} className="shrink-0" />
                      {upcomingEvent.location}
                    </div>
                  )}
                  {upcomingEvent.is_online && !upcomingEvent.location && (
                    <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                      <ExternalLink size={11} className="shrink-0" />
                      Online
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                    <Users size={11} className="shrink-0" />
                    {upcomingEvent.rsvp_count} going
                  </div>
                </div>
              </div>
            </div>
            <Link
              href={`/dashboard/communities/${communityId}/events/${upcomingEvent.id}`}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 font-body text-sm font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground transition-colors"
            >
              View Event
            </Link>
          </Section>
        )}

      </div>{/* end main info card */}

      {/* Community Stats — separate card below */}
      <div className="border border-border mr-4 mb-4 rounded-xl px-4 py-4">
        <span className="font-body text-sm font-semibold text-foreground block mb-3">
          Community Stats
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Members",     value: memberCount.toLocaleString() },
            { label: "Online",      value: onlineCount.toLocaleString() },
            { label: "Messages", value: postsToday != null ? postsToday.toLocaleString() : "—" },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-surface-raised rounded-xl px-3 py-3 flex flex-col gap-0.5 border border-border"
            >
              <span className="font-body text-base font-bold text-foreground">
                {value}
              </span>
              <span className="font-body text-[11px] text-foreground-muted leading-tight">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
