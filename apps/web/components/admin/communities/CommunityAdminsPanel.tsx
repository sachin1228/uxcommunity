"use client";
import { Button } from "@/components/ui/shadcn/button";


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
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="font-body text-sm font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck strokeWidth={2.5} size={14} className="text-primary" />
              Community admins
              <span className="ml-1 font-mono text-[11px] text-muted-foreground font-normal">
                {admins.length}
              </span>
            </h2>
            <p className="font-body text-[11px] text-muted-foreground mt-0.5">
              Admins get owner-style management controls in the app, scoped by the permissions you grant.
            </p>
          </div>
          <Button variant="default"
            onClick={() => setShowAdd(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 hover:opacity-90 transition-opacity"
          >
            <Plus strokeWidth={2.5} size={13} /> Add admin
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-4 w-4" />
          </div>
        ) : error ? (
          <p className="px-5 py-4 font-body text-xs text-red-400">{error}</p>
        ) : admins.length === 0 ? (
          <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground">
              <ShieldOff strokeWidth={2.5} size={16} />
            </span>
            <p className="font-body text-xs text-muted-foreground max-w-sm">
              No admins yet. Search the community&apos;s members and promote one to give them
              in-app management powers.
            </p>
            <Button variant="ghost"
              onClick={() => setShowAdd(true)}
              className="mt-1 inline-flex items-center gap-1 transition-colors"
            >
              <Plus strokeWidth={2.5} size={12} /> Add the first admin
            </Button>
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
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-popover/60 transition-colors"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-popover font-body text-xs font-semibold text-foreground">
                    {initialsOf(admin.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-medium text-foreground truncate">{admin.name}</p>
                    <p className="mt-0.5 font-body text-[11px] text-muted-foreground truncate">
                      {admin.email} · Admin since {fmtDate(admin.granted_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {permKeys.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center rounded-full bg-primary/10 border border-primary/15 px-2 py-0.5 font-body text-[10px] font-medium text-primary"
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
                    <Button variant="outline"
                      onClick={() => router.push(`/admin/communities/${communityId}/admins/${admin.user_id}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 transition-colors"
                    >
                      Manage <ChevronRight strokeWidth={2.5} size={12} />
                    </Button>

                    {confirmingId === admin.user_id ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 py-1 pl-2 pr-1">
                        <span className="font-body text-[10px] text-red-400">Remove?</span>
                        <Button variant="ghost"
                          onClick={() => handleRemove(admin)}
                          disabled={removingId === admin.user_id}
                          className="px-1 py-0.5 disabled:opacity-50"
                        >
                          {removingId === admin.user_id ? <Spinner className="h-3 w-3" /> : "Yes"}
                        </Button>
                        <Button variant="ghost"
                          onClick={() => setConfirmingId(null)}
                          className="px-1 py-0.5"
                        >
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button variant="destructive" size="icon"
                        onClick={() => setConfirmingId(admin.user_id)}
                        className="h-7 w-7 flex items-center justify-center transition-colors"
                        title="Remove admin rights (keeps them as a member)"
                        aria-label={`Remove admin rights for ${admin.name}`}
                      >
                        <ShieldOff strokeWidth={2.5} size={13} />
                      </Button>
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
