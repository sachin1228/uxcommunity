"use client";

import { useCallback, useEffect, useState } from "react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";

interface BlockedMember {
  id: string;
  name: string;
  avatar_url: string | null;
  blocked_at: string;
}

/**
 * Blocked accounts — the way back for every block a member has set. Renders
 * nothing while the list is empty; the card only exists when there is
 * something to undo.
 */
export function BlockedAccountsSection() {
  const [members, setMembers] = useState<BlockedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dm/blocks");
      const data = (await res.json().catch(() => null)) as
        | { blocked?: BlockedMember[] }
        | null;
      if (res.ok) setMembers(data?.blocked ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(member: BlockedMember) {
    if (pendingId) return;
    setPendingId(member.id);
    setError(null);
    try {
      const res = await fetch(`/api/dm/blocks?user_id=${member.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not unblock this member.");
        return;
      }
      setMembers((current) => current.filter((row) => row.id !== member.id));
    } catch {
      setError("Could not unblock this member.");
    } finally {
      setPendingId(null);
    }
  }

  if (loading || members.length === 0) return null;

  return (
    <section
      aria-labelledby="blocked-accounts-heading"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5"
    >
      <div>
        <h2
          id="blocked-accounts-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          Blocked accounts
        </h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Blocked members cannot message you, comment on your posts or notify you.
        </p>
      </div>

      <ul className="flex flex-col">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0 last:pb-0 first:pt-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <AvatarImg url={member.avatar_url} name={member.name} size={32} />
              <p className="truncate font-body text-sm text-foreground">{member.name}</p>
            </div>
            <button
              type="button"
              onClick={() => void unblock(member)}
              disabled={pendingId === member.id}
              className="modal-btn modal-btn-secondary shrink-0"
            >
              {pendingId === member.id && <Spinner size={12} />}
              Unblock
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p className="font-body text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
