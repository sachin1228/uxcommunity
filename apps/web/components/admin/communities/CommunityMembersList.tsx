"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CommunityMember } from "./communityTypes";
import { fmtDate } from "./communityTypes";

interface Props {
  members: CommunityMember[];
  memberCount: number;
}

export function CommunityMembersList({ members, memberCount }: Props) {
  const router = useRouter();

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="font-body text-xs font-semibold text-foreground">
          Members
          <span className="ml-2 font-mono text-[11px] text-foreground-muted font-normal">
            {memberCount > 20
              ? `Showing 20 of ${memberCount.toLocaleString()}`
              : memberCount}
          </span>
        </h2>
      </div>

      {members.length === 0 ? (
        <p className="px-5 py-6 font-body text-xs text-foreground-muted">No members yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-5 py-3 hover:bg-surface-raised transition-colors"
            >
              <div>
                <button
                  onClick={() => router.push(`/admin/users/${m.id}`)}
                  className="font-body text-xs font-medium text-foreground hover:text-accent transition-colors flex items-center gap-1"
                >
                  {m.name} <ExternalLink size={10} className="text-foreground-muted" />
                </button>
                <p className="font-body text-[11px] text-foreground-muted">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {m.role === "admin" && (
                  <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-500">
                    Admin
                  </span>
                )}
                {m.role === "owner" && (
                  <span className="inline-flex items-center rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 font-body text-[10px] font-semibold text-accent">
                    Owner
                  </span>
                )}
                <span className="font-body text-[11px] text-foreground-muted">
                  Joined {fmtDate(m.joined_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
