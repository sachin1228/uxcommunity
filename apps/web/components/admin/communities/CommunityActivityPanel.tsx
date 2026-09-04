"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityActivityEntry } from "./communityTypes";
import { actorInitials, actorLabel, describeActivity, fmtActivityTime } from "./communityActivity";

interface Props {
  communityId: string;
  /** When set, only this actor's actions are fetched (used on the admin page). */
  adminId?: string;
  limit?: number;
}

const ROLE_CHIP: Record<CommunityActivityEntry["actor_role"], string> = {
  platform: "bg-surface-raised text-foreground-muted border-border",
  admin: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  owner: "bg-accent/10 text-accent border-accent/20",
};

export function CommunityActivityPanel({ communityId, adminId, limit = 30 }: Props) {
  const [entries, setEntries] = useState<CommunityActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const qs = adminId ? `?admin_id=${encodeURIComponent(adminId)}&limit=${limit}` : `?limit=${limit}`;
    fetch(`/api/admin/communities/${communityId}/activity${qs}`)
      .then(async (r) => {
        const data = r.ok ? await r.json() : null;
        if (!data) { setError("Failed to load activity."); return; }
        setEntries(data.activity ?? []);
      })
      .catch(() => setError("Failed to load activity."))
      .finally(() => setLoading(false));
  }, [communityId, adminId, limit]);

  // Actor chips are derived from the fetched entries (platform first).
  const actors = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const entry of entries) {
      const id = entry.actor_role === "platform" ? "platform" : (entry.actor_id ?? `u-${entry.actor_name ?? ""}`);
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          name: actorLabel(entry),
        });
      }
    }
    return [...seen.values()];
  }, [entries]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((entry) => {
      const id = entry.actor_role === "platform" ? "platform" : (entry.actor_id ?? `u-${entry.actor_name ?? ""}`);
      return id === filter;
    });
  }, [entries, filter]);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="font-body text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Activity strokeWidth={2.5} size={13} className="text-accent" />
          {adminId ? "Admin activity" : "Management activity"}
        </h2>
        <p className="font-body text-[11px] text-foreground-muted mt-0.5">
          Every management action taken in this community by its admins, owner, or the platform.
        </p>
      </div>

      {/* Actor filter chips (community-wide feed only) */}
      {!adminId && actors.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
          {[{ id: "all", name: "All" }, ...actors].map((actor) => (
            <button
              key={actor.id}
              onClick={() => setFilter(actor.id)}
              className={`rounded-full px-2.5 py-1 font-body text-[11px] transition-colors border ${
                filter === actor.id
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              {actor.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-4 w-4" />
        </div>
      ) : error ? (
        <p className="px-5 py-4 font-body text-xs text-red-400">{error}</p>
      ) : visible.length === 0 ? (
        <div className="px-5 py-6 flex items-center gap-3">
          <ShieldCheck strokeWidth={2.5} size={16} className="text-foreground-muted/50 shrink-0" />
          <p className="font-body text-xs text-foreground-muted">
            No management activity recorded yet. Changes made by community admins and the platform will show up here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/70">
          {visible.map((entry) => {
            const isPlatform = entry.actor_role === "platform";
            return (
              <div key={entry.id} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-body text-[9px] font-bold ${
                    isPlatform ? "border-border bg-surface-raised text-foreground-muted" : ROLE_CHIP[entry.actor_role]
                  }`}
                >
                  {isPlatform ? "UX" : actorInitials(entry.actor_name ?? "?")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-xs text-foreground leading-relaxed">
                    <span className="font-semibold">
                      {entry.actor_role === "platform" ? "Platform" : (entry.actor_name ?? "Someone")}
                    </span>{" "}
                    {describeActivity(entry)}
                  </p>
                  <p className="font-body text-[10px] text-foreground-muted/70 mt-0.5">
                    {fmtActivityTime(entry.created_at)}
                    {!isPlatform && entry.actor_role === "admin" && (
                      <span className="ml-1.5 uppercase tracking-wider text-[9px] text-amber-500/70">admin</span>
                    )}
                    {!isPlatform && entry.actor_role === "owner" && (
                      <span className="ml-1.5 uppercase tracking-wider text-[9px] text-accent/70">owner</span>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
