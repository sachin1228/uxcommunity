"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Users, MessageSquare, Search } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface LastMessage {
  content: string;
  created_at: string;
  user: { name: string } | null;
}

interface Community {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  last_message: LastMessage | null;
}

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

// Ordered sections — label shown in sidebar, key = community.type
const SECTIONS: { label: string; type: Community["type"] }[] = [
  { label: "Company",    type: "company"          },
  { label: "Industry",   type: "sector"            },
  { label: "Interest",   type: "interest"          },
  { label: "Experience", type: "experience_level"  },
  { label: "City",       type: "city"              },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function CommunityAvatar({
  imageUrl,
  name,
  type,
  active,
}: {
  imageUrl: string | null;
  name: string;
  type: string;
  active: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = TYPE_EMOJI[type] ?? "💬";
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-base font-medium select-none ${
      active ? "bg-accent/20" : "bg-surface-raised"
    }`}>
      {fallback}
    </div>
  );
}

function CommunityRow({
  c,
  active,
 
  onClick,
}: {
  c: Community;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          active
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-surface-raised border-l-2 border-l-transparent"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
          active={active}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="font-body text-xs font-medium truncate text-foreground">
              {c.name}
            </span>
            {c.last_message && (
              <span className="font-mono text-[10px] text-foreground-muted shrink-0">
                {timeAgo(c.last_message.created_at)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {c.last_message ? (
              <p className="font-body text-[11px] text-foreground-muted truncate flex-1">
                <span className="font-medium">{c.last_message.user?.name?.split(" ")[0]}:</span>{" "}
                {c.last_message.content}
              </p>
            ) : (
              <p className="font-body text-[11px] text-foreground-muted/60 italic flex-1">No messages yet</p>
            )}
            <span className="flex items-center gap-0.5 text-foreground-muted shrink-0">
              <Users size={10} />
              <span className="font-mono text-[10px]">{c.member_count}</span>
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function SectionGroup({
  label,
  communities,
  activeCommunityId,
  onNavigate,
}: {
  label: string;
  communities: Community[];
  activeCommunityId: string | undefined;
  onNavigate: (id: string) => void;
}) {
  if (communities.length === 0) return null;

  return (
    <div>
      {/* Section label */}
      <div className="px-4 pt-4 pb-1">
        <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
          {label}
        </span>
      </div>

      {/* Community rows — always visible */}
      <ul>
        {communities.map((c, idx) => (
          <CommunityRow
            key={c.id}
            c={c}
            active={c.id === activeCommunityId}

            onClick={() => onNavigate(c.id)}
          />
        ))}
      </ul>
    </div>
  );
}

export function CommunitiesPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/communities");
      if (!res.ok) return;
      const data = await res.json();
      setCommunities(data.communities ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeCommunityId = pathname.match(/\/dashboard\/communities\/([^/]+)/)?.[1];

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-r border-border bg-surface">
      {/* Find communities button */}
      <Link
        href="/dashboard/communities"
        className={`flex items-center gap-2 mx-3 mt-3 mb-1 px-3 py-2 rounded-lg font-body text-xs font-medium transition-colors ${
          pathname === "/dashboard/communities"
            ? "bg-accent/10 text-accent"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <Search size={13} />
        Find &amp; all communities
      </Link>

      {/* Divider */}
      <div className="mx-3 mb-1 border-t border-border" />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : communities.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessageSquare size={24} className="mx-auto text-foreground-muted mb-2 opacity-40" />
            <p className="font-body text-xs text-foreground-muted">No communities yet</p>
          </div>
        ) : (
          /* Grouped view */
          <div className="py-1">
            {SECTIONS.map((section) => {
              const group = communities.filter((c) => c.type === section.type);
              return (
                <SectionGroup
                  key={section.type}
                  label={section.label}
                  communities={group}
                  activeCommunityId={activeCommunityId}
                  onNavigate={(id) => router.push(`/dashboard/communities/${id}`)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
