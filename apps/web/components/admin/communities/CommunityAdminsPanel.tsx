"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityAdminSearchModal } from "./CommunityAdminSearchModal";
import {
  type CommunityAdmin,
  type CommunityPermissionKey,
} from "./communityTypes";
import { fmtDate } from "./communityTypes";

const PERM_CHIP: Record<CommunityPermissionKey, string> = {
  can_edit_settings: "Settings",
  can_manage_members: "Members",
  can_delete_messages: "Moderation",
};

interface Props {
  communityId: string;
  communityName: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function CommunityAdminsPanel({ communityId, communityName }: Props) {
  const router = useRouter();
  const [admins, setAdmins] = useState<CommunityAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/communities/${communityId}/admins`)
      .then(async (r) => {
        const data = r.ok ? await r.json() : null;
        if (!cancelled) setAdmins(data?.admins ?? []);
      })
      .catch(() => { if (!cancelled) setError("Failed to load admins."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [communityId]);

  function handlePromoted(admin: CommunityAdmin) {
    setAdmins((prev) => {
      const without = prev.filter((a) => a.user_id !== admin.user_id);
      return [...without, admin].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    });
    setShowAdd(false);
  }

  async function handleRemove(admin: CommunityAdmin) {
    if (removingId) return;
    setRemovingId(admin.user_id);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/admins/${admin.user_id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAdmins((prev) => prev.filter((a) => a.user_id !== admin.user_id));
      }
    } finally {
      setRemovingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="font-body text-sm font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-accent" />
              Community admins
              <span className="ml-1 font-mono text-[11px] text-foreground-muted font-normal">
                {admins.length}
              </span>
            </h2>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              Admins get owner-style management controls in the app, scoped by the permissions you grant.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> Add admin
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-4 w-4" />
          </div>
        ) : error ? (
          <p className="px-5 py-4 font-body text-xs text-red-400">{error}</p>
        ) : admins.length === 0 ? (
          <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted">
              <ShieldOff size={16} />
            </span>
            <p className="font-body text-xs text-foreground-muted max-w-sm">
              No admins yet. Search the community&apos;s members and promote one to give them
              in-app management powers.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-1 inline-flex items-center gap-1 font-body text-xs text-accent hover:text-accent/80 transition-colors"
            >
              <Plus size={12} /> Add the first admin
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {admins.map((admin) => {
              const permKeys = (Object.keys(PERM_CHIP) as CommunityPermissionKey[]).filter(
                (key) => admin.permissions[key],
              );
              const limited = permKeys.length < 3;
              return (
                <div
                  key={admin.user_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-surface-raised/60 transition-colors"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised font-body text-xs font-semibold text-foreground">
                    {initialsOf(admin.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-medium text-foreground truncate">{admin.name}</p>
                    <p className="mt-0.5 font-body text-[11px] text-foreground-muted truncate">
                      {admin.email} · Admin since {fmtDate(admin.granted_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {permKeys.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center rounded-full bg-accent/10 border border-accent/15 px-2 py-0.5 font-body text-[10px] font-medium text-accent"
                      >
                        {PERM_CHIP[key]}
                      </span>
                    ))}
                    {limited && (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-body text-[10px] font-medium text-amber-500">
                        Limited
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => router.push(`/admin/communities/${communityId}/admins/${admin.user_id}`)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
                    >
                      Manage <ChevronRight size={12} />
                    </button>

                    {confirmingId === admin.user_id ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 py-1 pl-2 pr-1">
                        <span className="font-body text-[10px] text-red-400">Remove?</span>
                        <button
                          onClick={() => handleRemove(admin)}
                          disabled={removingId === admin.user_id}
                          className="px-1 py-0.5 font-body text-[11px] font-semibold text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          {removingId === admin.user_id ? <Spinner className="h-3 w-3" /> : "Yes"}
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          className="px-1 py-0.5 font-body text-[11px] text-foreground-muted hover:text-foreground"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmingId(admin.user_id)}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove admin rights (keeps them as a member)"
                        aria-label={`Remove admin rights for ${admin.name}`}
                      >
                        <ShieldOff size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <CommunityAdminSearchModal
          communityId={communityId}
          communityName={communityName}
          onClose={() => setShowAdd(false)}
          onPromoted={handlePromoted}
        />
      )}
    </>
  );
}
