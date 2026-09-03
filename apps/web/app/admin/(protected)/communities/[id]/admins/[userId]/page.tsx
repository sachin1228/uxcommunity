"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ShieldCheck,
  ShieldOff,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityActivityPanel } from "@/components/admin/communities/CommunityActivityPanel";
import {
  PERMISSION_OPTIONS,
  type CommunityAdmin,
  type CommunityPermissionFlags,
} from "@/components/admin/communities/communityTypes";
import { fmtDate, fmtDateTime } from "@/components/admin/communities/communityTypes";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

export default function CommunityAdminPermissionsPage() {
  const { id: communityId, userId } = useParams<{ id: string; userId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState<CommunityAdmin | null>(null);
  const [communityName, setCommunityName] = useState("");
  const [notFound, setNotFound] = useState(false);

  const [permissions, setPermissions] = useState<CommunityPermissionFlags | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/communities/${communityId}/admins`)
      .then(async (r) => {
        const data = r.ok ? await r.json() : null;
        if (!data) { setNotFound(true); return; }
        const found = (data.admins ?? []).find((a: CommunityAdmin) => a.user_id === userId) ?? null;
        if (!found) { setNotFound(true); return; }
        setAdmin(found);
        setCommunityName(data.community?.name ?? "");
        setPermissions({ ...found.permissions });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [communityId, userId]);

  async function handleSave() {
    if (!permissions || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/admins/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Failed to save permissions." });
        return;
      }
      setPermissions(data.permissions);
      setSaveMsg({ ok: true, text: "Permissions saved." });
      setTimeout(() => setSaveMsg(null), 2500);
    } catch {
      setSaveMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveAdmin() {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/admins/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) router.push(`/admin/communities/${communityId}`);
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (notFound || !admin || !permissions) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <ShieldOff size={24} className="text-foreground-muted/60" />
        <p className="font-body text-sm text-foreground-muted">
          This member is not an admin of this community (or the community was removed).
        </p>
        <button
          onClick={() => router.push(`/admin/communities/${communityId}`)}
          className="font-body text-xs text-accent hover:underline"
        >
          Back to community
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Back */}
      <button
        onClick={() => router.push(`/admin/communities/${communityId}`)}
        className="flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={13} /> {communityName || "Community"}
      </button>

      {/* Identity card */}
      <div className="rounded-xl border border-border bg-surface p-5 flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised font-display text-base font-semibold text-foreground">
          {initials(admin.name)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg font-semibold text-foreground truncate">{admin.name}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-500 shrink-0">
              <ShieldCheck size={10} /> Community admin
            </span>
          </div>
          <p className="font-body text-[11px] text-foreground-muted mt-0.5 truncate">{admin.email}</p>
          <p className="font-body text-[11px] text-foreground-muted/80 mt-0.5">
            Admin of {communityName || "this community"} since {fmtDate(admin.granted_at)} · member since{" "}
            {fmtDate(admin.joined_at)}
          </p>
        </div>
      </div>

      {/* Permissions */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-body text-xs font-semibold text-foreground">Permissions</h2>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              These control what {admin.name.split(" ")[0]} can do in the app for this community.
              Owners &amp; the platform always keep full control.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Spinner className="h-3 w-3 text-accent-foreground" /> : <Save size={12} />}
            Save changes
          </button>
        </div>

        {saveMsg && (
          <div
            className={`mx-5 mt-3 rounded-md border px-3 py-2 font-body text-xs ${
              saveMsg.ok
                ? "border-green-500/20 bg-green-500/10 text-green-400"
                : "border-red-500/20 bg-red-500/10 text-red-400"
            }`}
          >
            {saveMsg.text}
          </div>
        )}

        <div className="divide-y divide-border">
          {PERMISSION_OPTIONS.map(({ key, label, description }) => {
            const checked = permissions[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-body text-xs font-medium text-foreground">{label}</p>
                  <p className="font-body text-[11px] text-foreground-muted mt-0.5">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  onClick={() => setPermissions((prev) => prev ? { ...prev, [key]: !prev[key] } : prev)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    checked ? "bg-accent" : "bg-surface-raised border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      checked ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-border bg-surface-raised/40">
          <p className="font-body text-[11px] text-foreground-muted flex items-center gap-1.5">
            <Check size={11} className="text-green-400 shrink-0" />
            Permissions apply instantly — their next action in the app is checked against these.
          </p>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/20 bg-surface overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between gap-4">
          <div>
            <p className="font-body text-xs font-medium text-red-400">Remove admin rights</p>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              {admin.name.split(" ")[0]} stays a regular member — they just lose the in-app management controls.
            </p>
          </div>
          <button
            onClick={() => setShowRemoveConfirm(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12} /> Remove admin
          </button>
        </div>
      </div>

      {/* Activity */}
      <CommunityActivityPanel communityId={communityId} adminId={admin.user_id} />

      {/* Remove confirm modal */}
      {showRemoveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowRemoveConfirm(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-foreground mb-1 flex items-center gap-2">
              <ShieldOff size={15} className="text-red-400" /> Remove {admin.name.split(" ")[0]}&apos;s admin rights?
            </h2>
            <p className="font-body text-xs text-foreground-muted mb-5">
              They will remain a member of <span className="text-foreground font-medium">{communityName}</span> but
              lose access to community settings, member management, and message moderation in the app.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRemoveConfirm(false)}
                disabled={removing}
                className="flex-1 rounded-md border border-border py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised transition-colors disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1"><X size={11} /> Cancel</span>
              </button>
              <button
                onClick={handleRemoveAdmin}
                disabled={removing}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-2 font-body text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {removing ? <Spinner className="h-3 w-3" /> : <ShieldOff size={11} />} Remove admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
