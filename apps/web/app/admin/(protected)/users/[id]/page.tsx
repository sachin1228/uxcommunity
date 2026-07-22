"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShieldOff, ShieldCheck, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { UserInfoCard } from "@/components/admin/users/UserInfoCard";
import type { AdminUser, UserApplication, UserInterest } from "@/components/admin/users/userTypes";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [application, setApplication] = useState<UserApplication | null>(null);
  const [interests, setInterests] = useState<UserInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/users/${id}`);
        if (!res.ok) { setError("User not found."); return; }
        const data = await res.json();
        setUser(data.user);
        setApplication(data.application ?? null);
        setInterests(data.interests ?? []);
      } catch {
        setError("Failed to load user.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleBlock() {
    if (!user) return;
    setActionLoading("block");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_blocked: !user.is_blocked }),
      });
      const data = await res.json();
      setUser((u) => u ? { ...u, is_blocked: data.user.is_blocked } : u);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!user) return;
    setActionLoading("delete");
    try {
      await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      router.push("/admin/users");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-5 w-5 text-foreground-muted" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="py-16 text-center font-body text-sm text-foreground-muted">
        {error ?? "User not found."}
      </div>
    );
  }

  const avatarUrl = user.designer_profiles?.avatar_url;
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-2xl">
      {/* Back */}
      <button
        onClick={() => router.push("/admin/users")}
        className="mb-6 flex items-center gap-1.5 font-body text-sm text-foreground-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Back to users
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <span className="h-16 w-16 shrink-0 rounded-full overflow-hidden ring-1 ring-border flex items-center justify-center bg-surface-raised">
              <AvatarImg
                url={avatarUrl}
                name={user.name}
                size={64}
                className="h-16 w-16 rounded-full object-cover"
              />
            </span>
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-raised ring-1 ring-border font-display text-xl font-semibold text-foreground-muted select-none">
              {initials}
            </span>
          )}
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{user.name}</h1>
            <span
              className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${
                user.is_blocked
                  ? "bg-red-500/10 text-red-400"
                  : "bg-green-500/10 text-green-400"
              }`}
            >
              {user.is_blocked ? "Blocked" : "Active"}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleBlock}
            disabled={!!actionLoading}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 font-body text-sm transition-colors disabled:opacity-50 ${
              user.is_blocked
                ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                : "border-border text-foreground-muted hover:text-red-400 hover:border-red-400/30"
            }`}
          >
            {actionLoading === "block" ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : user.is_blocked ? (
              <ShieldCheck size={14} />
            ) : (
              <ShieldOff size={14} />
            )}
            {user.is_blocked ? "Unblock" : "Block"}
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            disabled={!!actionLoading}
            className="flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      {/* Details card */}
      <UserInfoCard user={user} application={application} interests={interests} />

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="font-display text-lg font-semibold text-foreground mb-1">
              Delete account?
            </h2>
            <p className="font-body text-sm text-foreground-muted mb-6">
              This will permanently remove{" "}
              <span className="text-foreground font-medium">{user.name}</span>{" "}
              ({user.email}) and all their data. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-md border border-border py-2 font-body text-sm text-foreground-muted hover:bg-surface-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!!actionLoading}
                className="flex-1 flex items-center justify-center gap-2 rounded-md bg-red-600 py-2 font-body text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {actionLoading === "delete" ? <Spinner className="h-4 w-4" /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
