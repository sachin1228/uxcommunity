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
  CalendarDays,
  UserRound,
  Clock3,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { CommunityActivityPanel } from "@/components/admin/communities/CommunityActivityPanel";
import {
  PERMISSION_OPTIONS,
  type CommunityAdmin,
  type CommunityPermissionFlags,
  type CommunityPermissionKey,
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
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
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
        setSavedSnapshot(JSON.stringify(found.permissions));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [communityId, userId]);

  const dirty = Boolean(
    permissions && savedSnapshot && JSON.stringify(permissions) !== savedSnapshot
  );

  async function handleSave() {
    if (!permissions || !dirty || saving) return;
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
      setSavedSnapshot(JSON.stringify(data.permissions));
      setSaveMsg({ ok: true, text: "Permissions saved — they apply to the next action this admin takes." });
      setTimeout(() => setSaveMsg(null), 3000);
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

  function togglePermission(key: CommunityPermissionKey) {
    if (!permissions) return;
    setPermissions((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev));
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
        <ShieldOff strokeWidth={2.5} size={24} className="text-foreground-muted/60" />
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

  const firstName = admin.name.split(" ")[0];

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Back */}
      <button
        onClick={() => router.push(`/admin/communities/${communityId}`)}
        className="flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft strokeWidth={2.5} size={13} /> {communityName || "Community"}
      </button>

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-6 py-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised font-display text-lg font-semibold text-foreground">
            {initials(admin.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-foreground truncate">{admin.name}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-500 shrink-0">
                <ShieldCheck strokeWidth={2.5} size={10} /> Community admin
              </span>
            </div>
            <p className="font-body text-xs text-foreground-muted mt-0.5 truncate">{admin.email}</p>
            <p className="font-body text-[11px] text-foreground-muted/80 mt-1">
              Admin of {communityName || "this community"} since {fmtDate(admin.granted_at)} · member since{" "}
              {fmtDate(admin.joined_at)}
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-body text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? <Spinner className="h-3 w-3 text-accent-foreground" /> : <Save strokeWidth={2.5} size={12} />}
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>

      {/* Body: permissions + activity (left) | about + danger (right) */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {/* Permissions */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-body text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck strokeWidth={2.5} size={14} className="text-accent" /> Permissions
              </h2>
              <p className="font-body text-[11px] text-foreground-muted mt-0.5">
                These control what {firstName} can do in the app for this community.
                Owners &amp; the platform always keep full control.
              </p>
            </div>

            {saveMsg && (
              <div
                className={`mx-5 mt-4 rounded-md border px-3 py-2 font-body text-xs ${
                  saveMsg.ok
                    ? "border-green-500/20 bg-green-500/10 text-green-400"
                    : "border-red-500/20 bg-red-500/10 text-red-400"
                }`}
              >
                {saveMsg.text}
              </div>
            )}

            <div className="divide-y divide-border/70">
              {PERMISSION_OPTIONS.map(({ key, label, description }) => {
                const checked = permissions[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-6 px-5 py-4">
                    <div className="min-w-0">
                      <p className="font-body text-sm font-medium text-foreground">{label}</p>
                      <p className="font-body text-[11px] text-foreground-muted mt-1 max-w-xl leading-relaxed">
                        {description}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={label}
                      onClick={() => togglePermission(key)}
                      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
                        checked
                          ? "bg-accent border-transparent"
                          : "bg-surface-raised border-border"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-all duration-200 ${
                          checked ? "translate-x-5 bg-accent-foreground" : "translate-x-0 bg-foreground"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-border/70 bg-surface-raised/40">
              <p className="font-body text-[11px] text-foreground-muted flex items-center gap-1.5">
                <Check strokeWidth={2.5} size={11} className="text-green-400 shrink-0" />
                Permissions apply instantly — their next action in the app is checked against these.
              </p>
            </div>
          </div>

          {/* Admin activity */}
          <CommunityActivityPanel communityId={communityId} adminId={admin.user_id} />
        </div>

        {/* Right rail */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* About */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-body text-sm font-semibold text-foreground">About</h2>
            </div>
            <div className="divide-y divide-border/70">
              <div className="flex items-center gap-3 px-5 py-3.5">
                <UserRound strokeWidth={2.5} size={13} className="text-foreground-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[11px] text-foreground-muted">Member of {communityName || "this community"}</p>
                  <p className="font-body text-xs text-foreground mt-0.5">since {fmtDate(admin.joined_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-3.5">
                <CalendarDays strokeWidth={2.5} size={13} className="text-foreground-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[11px] text-foreground-muted">Admin since</p>
                  <p className="font-body text-xs text-foreground mt-0.5">{fmtDate(admin.granted_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-3.5">
                <Clock3 strokeWidth={2.5} size={13} className="text-foreground-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[11px] text-foreground-muted">Permissions last changed</p>
                  <p className="font-body text-xs text-foreground mt-0.5">
                    {admin.updated_at ? fmtDateTime(admin.updated_at) : "Never"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div className="rounded-xl border border-red-500/20 bg-surface overflow-hidden">
            <div className="px-5 py-4">
              <p className="font-body text-sm font-medium text-red-400">Remove admin rights</p>
              <p className="font-body text-[11px] text-foreground-muted mt-1 leading-relaxed">
                {firstName} stays a regular member — they just lose the in-app management controls.
              </p>
              <button
                onClick={() => setShowRemoveConfirm(true)}
                className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 strokeWidth={2.5} size={12} /> Remove admin
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Remove confirm modal */}
      {showRemoveConfirm && (
        <ModalPortal>
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowRemoveConfirm(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-foreground mb-1 flex items-center gap-2">
              <ShieldOff strokeWidth={2.5} size={15} className="text-red-400" /> Remove {firstName}&apos;s admin rights?
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
                <span className="inline-flex items-center gap-1"><X strokeWidth={2.5} size={11} /> Cancel</span>
              </button>
              <button
                onClick={handleRemoveAdmin}
                disabled={removing}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-2 font-body text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {removing ? <Spinner className="h-3 w-3" /> : <ShieldOff strokeWidth={2.5} size={11} />} Remove admin
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
