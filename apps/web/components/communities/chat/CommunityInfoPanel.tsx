"use client";

import {
  MapPin,
  Calendar,
  Download,
  Users,
  FileText,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";

interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

interface CommunityInfoPanelProps {
  members: Member[];
  community: { member_count: number } | null;
}

// ─── Static data (replace with real API later) ────────────────────────────────
const STATIC_ABOUT = {
  description:
    "A community for designers working at Amazon across India to connect, share, and grow together.",
  location: "Pune, India",
  createdAt: "23 May 2024",
  tags: ["Design", "Amazon", "Product Design", "+2"],
};

const STATIC_EVENT = {
  title: "Pune Designers Meetup",
  date: "26 Jul, 2025 · 4:00 PM",
  location: "Mariplex, Pune",
  going: 32,
};

const STATIC_RESOURCES = [
  { name: "Design System Guidelines", meta: "PDF · 2.4 MB" },
  { name: "Amazon Design Principles",  meta: "PDF · 1.1 MB" },
  { name: "Figma Component Library",   meta: "Figma File · 12.4 MB" },
];

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
    <div className="px-4 py-4 border-b border-border">
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
export function CommunityInfoPanel({ members, community }: CommunityInfoPanelProps) {
  const memberCount = community?.member_count ?? members.length;

  return (
    // Outer wrapper — sizing + scroll, holds both cards
    <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">

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
        <Section title="About">
          <p className="font-body text-[13px] text-foreground-muted leading-relaxed mb-3">
            {STATIC_ABOUT.description}
          </p>
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 font-body text-[13px] text-foreground-muted">
              <MapPin size={13} className="shrink-0 text-foreground-subtle" />
              {STATIC_ABOUT.location}
            </div>
            <div className="flex items-center gap-2 font-body text-[13px] text-foreground-muted">
              <Calendar size={13} className="shrink-0 text-foreground-subtle" />
              Created {STATIC_ABOUT.createdAt}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATIC_ABOUT.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-0.5 rounded-full border border-border font-body text-[12px] text-foreground-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </Section>

        {/* Upcoming Events */}
        <Section title="Upcoming Events" action={<SeeAll />}>
          <div className="flex gap-3">
            <div className="w-16 h-16 rounded-lg bg-surface-raised shrink-0 flex items-center justify-center overflow-hidden border border-border">
              <Calendar size={20} className="text-foreground-subtle" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body text-[13px] font-semibold text-foreground leading-snug mb-1">
                {STATIC_EVENT.title}
              </p>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                  <Calendar size={11} className="shrink-0" />
                  {STATIC_EVENT.date}
                </div>
                <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                  <MapPin size={11} className="shrink-0" />
                  {STATIC_EVENT.location}
                </div>
                <div className="flex items-center gap-1.5 font-body text-[12px] text-foreground-muted">
                  <Users size={11} className="shrink-0" />
                  {STATIC_EVENT.going} going
                </div>
              </div>
            </div>
          </div>
          <button className="mt-3 w-full py-1.5 rounded-lg bg-accent font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors">
            Join
          </button>
        </Section>

        {/* Popular Resources — last section, no border-b */}
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-body text-sm font-semibold text-foreground">
              Popular Resources
            </span>
            <SeeAll />
          </div>
          <div className="space-y-3">
            {STATIC_RESOURCES.map((r) => (
              <div key={r.name} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0 border border-border">
                  <FileText size={14} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-[13px] font-medium text-foreground truncate">
                    {r.name}
                  </p>
                  <p className="font-body text-[11px] text-foreground-muted">
                    {r.meta}
                  </p>
                </div>
                <button className="shrink-0 text-foreground-muted hover:text-foreground transition-colors">
                  <Download size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>{/* end main info card */}

      {/* Community Stats — separate card below */}
      <div className="border border-border mr-4 mb-4 rounded-xl px-4 py-4">
        <span className="font-body text-sm font-semibold text-foreground block mb-3">
          Community Stats
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Members",     value: memberCount.toLocaleString() },
            { label: "Online",      value: "156" },
            { label: "Posts today", value: "32" },
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
