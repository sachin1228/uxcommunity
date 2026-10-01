"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ChatAvatar } from "@/components/communities/chat/ChatAvatar";
import {
  actorLabel,
  describeActivity,
  fmtActivityTime,
  type CommunityActivityEntry,
} from "@/lib/communities/activity";

/** Role accents shared with the platform dashboard's activity feed. */
const ROLE_CHIP: Record<CommunityActivityEntry["actor_role"], string> = {
  platform: "border-border bg-surface-raised text-foreground-muted",
  admin: "border-amber-500/20 bg-amber-500/10 text-amber-500",
  moderator: "border-sky-500/20 bg-sky-500/10 text-sky-400",
  owner: "border-accent/20 bg-accent/10 text-accent",
};

const ROLE_TAG: Record<CommunityActivityEntry["actor_role"], string> = {
  platform: "text-foreground-muted/70",
  admin: "text-amber-500/70",
  moderator: "text-sky-400/70",
  owner: "text-accent/70",
};

const entryActorId = (entry: CommunityActivityEntry) =>
  entry.actor_id ?? `u-${entry.actor_name ?? ""}`;

/**
 * The owner's management audit trail — who did what, most recent first.
 * Mounted as the owner-only Activity tab (see ChatHeader's showActivityTab).
 */
export function ActivityView({ communityId }: { communityId: string }) {
  const [entries, setEntries] = useState<CommunityActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actorFilter, setActorFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/communities/${communityId}/activity`)
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (!data) { setError("Failed to load activity."); return; }
        setEntries(data.activity ?? []);
      })
      .catch(() => { if (!cancelled) setError("Failed to load activity."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [communityId, reloadKey]);

  function retry() {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }

  // Actor chips are derived from the fetched entries — one per distinct manager.
  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const id = entryActorId(entry);
      if (!seen.has(id)) seen.set(id, actorLabel(entry));
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [entries]);

  const visible = useMemo(
    () => (actorFilter === "all" ? entries : entries.filter((entry) => entryActorId(entry) === actorFilter)),
    [entries, actorFilter],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="px-5 pt-4 pb-1 shrink-0">
        <p className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
          Management activity
        </p>
        <p className="font-body text-xs text-foreground-muted mt-1">
          Every action taken in this community — who did what, most recent first.
        </p>
      </div>

      {!loading && !error && actors.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2 shrink-0">
          {[{ id: "all", name: "All" }, ...actors].map((actor) => (
            <button
              key={actor.id}
              type="button"
              onClick={() => setActorFilter(actor.id)}
              className={`rounded-full border px-2.5 py-1 font-body text-[11px] transition-colors ${
                actorFilter === actor.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              {actor.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={20} />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="font-body text-xs text-foreground-muted">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg border border-border px-4 py-1.5 font-body text-xs transition-colors hover:bg-surface-raised"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <ShieldCheck strokeWidth={2} size={20} className="text-foreground-muted/50" aria-hidden="true" />
            <p className="max-w-xs font-body text-xs text-foreground-muted leading-relaxed">
              {actorFilter === "all"
                ? "No management activity yet. Actions taken by admins and moderators will appear here."
                : "No activity from this manager yet."}
            </p>
          </div>
        ) : (
          <ul className="px-2 pb-4">
            {visible.map((entry) => {
              const isPlatform = entry.actor_role === "platform";
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-raised/50"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border p-0.5 font-body text-[8px] font-bold ${ROLE_CHIP[entry.actor_role]}`}
                  >
                    {isPlatform ? (
                      "UX"
                    ) : (
                      <ChatAvatar
                        name={entry.actor_name ?? "?"}
                        url={entry.actor_avatar_url ?? null}
                        size={6}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-xs text-foreground leading-relaxed">
                      <span className="font-semibold">{actorLabel(entry)}</span>{" "}
                      {describeActivity(entry)}
                    </p>
                    <p className="font-body text-[10px] text-foreground-muted/70 mt-0.5">
                      {fmtActivityTime(entry.created_at)}
                      <span className={`ml-1.5 uppercase tracking-wider text-[9px] ${ROLE_TAG[entry.actor_role]}`}>
                        {entry.actor_role}
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
