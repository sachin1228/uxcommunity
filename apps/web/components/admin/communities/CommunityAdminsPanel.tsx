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

export function CommunityAdminsPanel({ communityId, communityName }: Props) {
  const router = useRouter();
  const [admins, setAdmins] = useState<CommunityAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="font-body text-xs font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-accent" />
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
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground hover:bg-surface-raised transition-colors"
          >
            <Plus size={13} /> Add admin
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-4 w-4" />
          </div>
        ) : error ? (
          <p className="px-5 py-4 font-body text-xs text-red-400">{error}</p>
        ) : admins.length === 0 ? (
          <div className="px-5 py-6 flex flex-col items-start gap-2">
            <p className="font-body text-xs text-foreground-muted">
              No admins yet. Search the community&apos;s members and promote one to give them
              in-app management powers.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1 font-body text-xs text-accent hover:text-accent/80 transition-colors"
            >
              <Plus size={12} /> Add the first admin
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {admins.map((admin) => {
              const permKeys = (Object.keys(PERM_CHIP) as CommunityPermissionKey[]).filter(
                (key) => admin.permissions[key],
              );
              const initials = admin.name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0] ?? "")
                .join("")
                .toUpperCase();
              return (
                <div key={admin.user_id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-raised transition-colors">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised font-body text-[11px] font-semibold text-foreground">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-xs font-medium text-foreground">{admin.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="font-body text-[10px] text-foreground-muted">{admin.email}</span>
                      <span className="text-foreground-muted/40">•</span>
                      <span className="font-body text-[10px] text-foreground-muted">
                        Admin since {fmtDate(admin.granted_at)}
                      </span>
                      {permKeys.length < 3 && (
                        <>
                          <span className="text-foreground-muted/40">•</span>
                          <span className="font-body text-[10px] text-amber-500/80">
                            Limited permissions
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:flex flex-wrap items-center gap-1 justify-end max-w-44">
                    {permKeys.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center rounded-full bg-accent/10 border border-accent/15 px-2 py-0.5 font-body text-[10px] font-medium text-accent"
                      >
                        {PERM_CHIP[key]}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => router.push(`/admin/communities/${communityId}/admins/${admin.user_id}`)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
                  >
                    Manage <ChevronRight size={12} />
                  </button>
                  <button
                    onClick={() => handleRemove(admin)}
                    disabled={removingId === admin.user_id}
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="Remove admin rights (keeps them as a member)"
                    aria-label={`Remove admin rights for ${admin.name}`}
                  >
                    {removingId === admin.user_id ? <Spinner className="h-3.5 w-3.5" /> : <ShieldOff size={13} />}
                  </button>
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
