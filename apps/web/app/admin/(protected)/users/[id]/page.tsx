"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShieldOff, ShieldCheck, Trash2, ExternalLink } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarImg } from "@/components/ui/AvatarImg";

interface Profile {
  experience_level: string;
  avatar_url?: string | null;
  avatar_source?: string | null;
  companies: { name: string } | null;
  cities: { name: string } | null;
  design_sectors: { name: string } | null;
}

interface Interest {
  id: string;
  name: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  is_blocked: boolean;
  created_at: string;
  application_id: string | null;
  designer_profiles: Profile | null;
}

interface Application {
  linkedin_url: string | null;
  portfolio_url: string | null;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  student:       "Student",
  fresher:       "Fresher (0–1 yrs)",
  junior:        "Junior Designer (1–3 yrs)",
  mid_level:     "Mid-Level Designer (3–5 yrs)",
  senior:        "Senior Designer (5–8 yrs)",
  lead:          "Lead Designer (8–12 yrs)",
  principal:     "Principal Designer",
  staff:         "Staff Designer",
  design_manager:"Design Manager",
  head_of_design:"Head of Design",
  director:      "Director of Design",
  vp:            "VP of Design",
  consultant:    "Design Consultant",
  freelancer:    "Freelancer",
};

const SOURCE_LABELS: Record<string, string> = {
  dicebear:         "DiceBear (generated)",
  "boring-avatars": "Boring Avatars (generated)",
  robohash:         "Robohash (generated)",
  upload:           "Custom upload",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3.5 border-b border-border last:border-0">
      <span className="w-40 shrink-0 font-body text-sm text-foreground-muted">{label}</span>
      <span className="font-body text-sm text-foreground">{value}</span>
    </div>
  );
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
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

  const profile = user.designer_profiles;
  const avatarUrl = profile?.avatar_url;
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
          {/* Avatar */}
          {avatarUrl ? (
            <span className="h-16 w-16 shrink-0 rounded-full overflow-hidden ring-1 ring-border flex items-center justify-center bg-surface-raised">
              <AvatarImg url={avatarUrl} name={user.name} size={64} className="h-16 w-16 rounded-full object-cover" />
            </span>
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-raised ring-1 ring-border font-display text-xl font-semibold text-foreground-muted select-none">
              {initials}
            </span>
          )}

          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{user.name}</h1>
            <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${
              user.is_blocked ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
            }`}>
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
      <div className="rounded-xl border border-border bg-surface px-6 py-1">

        {/* Profile picture row */}
        <InfoRow
          label="Profile picture"
          value={
            avatarUrl ? (
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-surface-raised">
                  <AvatarImg url={avatarUrl} name={user.name} size={40} className="h-10 w-10 rounded-full object-cover" />
                </span>
                <span className="text-foreground-muted text-xs">
                  {SOURCE_LABELS[profile?.avatar_source ?? ""] ?? profile?.avatar_source ?? ""}
                </span>
              </div>
            ) : (
              <span className="text-foreground-muted">No avatar set</span>
            )
          }
        />

        <InfoRow label="Email" value={user.email} />
        <InfoRow
          label="Joined"
          value={new Date(user.created_at).toLocaleDateString("en-GB", {
            day: "numeric", month: "long", year: "numeric",
          })}
        />
        <InfoRow label="Company" value={profile?.companies?.name ?? "—"} />
        <InfoRow label="City" value={profile?.cities?.name ?? "—"} />
        <InfoRow label="Industry Sector" value={profile?.design_sectors?.name ?? "—"} />
        <InfoRow
          label="Interests"
          value={
            interests.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {interests.map((i) => (
                  <span
                    key={i.id}
                    className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 font-body text-xs text-accent"
                  >
                    {i.name}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-foreground-muted">—</span>
            )
          }
        />
        <InfoRow
          label="Experience Level"
          value={EXPERIENCE_LABELS[profile?.experience_level ?? ""] ?? profile?.experience_level ?? "—"}
        />
        <InfoRow
          label="LinkedIn"
          value={
            application?.linkedin_url ? (
              <a
                href={application.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-accent hover:underline"
              >
                {application.linkedin_url}
                <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : "—"
          }
        />
        <InfoRow
          label="Portfolio"
          value={
            application?.portfolio_url ? (
              <a
                href={application.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-accent hover:underline"
              >
                {application.portfolio_url}
                <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : "—"
          }
        />
      </div>

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
