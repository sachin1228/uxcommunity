"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Clapperboard, Upload, Trash2, RefreshCcw, X, Film, Building2, MapPin, Layers, Sparkles, TrendingUp, Globe } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { invalidateLottieCache } from "@/components/ui/LottieLoader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LottieSetting {
  id: string;
  scope: "universal" | "type" | "community";
  scope_key: string;
  lottie_url: string;
}

interface Community {
  id: string;
  name: string;
  type: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_CONFIG: {
  key: string;
  label: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}[] = [
  { key: "company",          label: "Company",    Icon: Building2  },
  { key: "sector",           label: "Industry",   Icon: Layers     },
  { key: "interest",         label: "Interest",   Icon: Sparkles   },
  { key: "experience_level", label: "Experience", Icon: TrendingUp },
  { key: "city",             label: "City",       Icon: MapPin     },
];

// ─── Upload helpers ───────────────────────────────────────────────────────────

async function uploadLottieFile(
  file: File,
  onError: (msg: string) => void
): Promise<string | null> {
  if (!file.name.endsWith(".json")) {
    onError("Please upload a .json Lottie file.");
    return null;
  }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/admin/lottie-upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) { onError(data.error ?? "Upload failed."); return null; }
  return data.url as string;
}

async function saveSetting(
  scope: "universal" | "type" | "community",
  scope_key: string,
  lottie_url: string
): Promise<boolean> {
  const res = await fetch("/api/admin/lottie-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, scope_key, lottie_url }),
  });
  return res.ok;
}

async function deleteSetting(id: string): Promise<boolean> {
  const res = await fetch(`/api/admin/lottie-settings/${id}`, { method: "DELETE" });
  return res.ok;
}

// ─── Small reusable upload card ───────────────────────────────────────────────

function AnimationSlot({
  label,
  setting,
  onUpload,
  onDelete,
  uploading,
}: {
  label: string;
  setting: LottieSetting | null;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-surface-raised flex items-center justify-center">
          {setting ? (
            <Film size={16} className="text-accent" />
          ) : (
            <Clapperboard size={16} className="text-foreground-muted" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-body text-xs font-medium text-foreground">{label}</p>
          {setting ? (
            <p className="font-mono text-[10px] text-foreground-muted truncate max-w-[260px]">
              {setting.lottie_url.split("/").pop()}
            </p>
          ) : (
            <p className="font-body text-[10px] text-foreground-muted">No animation set</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {setting && (
          <button
            onClick={handleDelete}
            disabled={deleting || uploading}
            title="Remove animation"
            className="h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
          >
            {deleting ? <Spinner className="h-3 w-3" /> : <Trash2 size={13} />}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { onUpload(file); e.target.value = ""; }
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || deleting}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
        >
          {uploading ? <Spinner className="h-3 w-3" /> : <Upload size={12} />}
          {setting ? "Replace" : "Upload"}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LottieAnimationsPage() {
  const [settings, setSettings] = useState<LottieSetting[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-slot uploading state: key = scope:scope_key
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settRes, commRes] = await Promise.all([
        fetch("/api/admin/lottie-settings"),
        fetch("/api/admin/communities"),
      ]);
      const [settData, commData] = await Promise.all([
        settRes.json(),
        commRes.json(),
      ]);
      setSettings(settData.settings ?? []);
      setCommunities(commData.communities ?? []);
    } catch {
      setError("Failed to load data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function getSetting(scope: LottieSetting["scope"], scope_key: string): LottieSetting | null {
    return settings.find((s) => s.scope === scope && s.scope_key === scope_key) ?? null;
  }

  function slotKey(scope: string, scope_key: string) { return `${scope}:${scope_key}`; }

  async function handleUpload(
    scope: LottieSetting["scope"],
    scope_key: string,
    file: File
  ) {
    const key = slotKey(scope, scope_key);
    setUploading((p) => ({ ...p, [key]: true }));
    setError(null);
    try {
      const url = await uploadLottieFile(file, setError);
      if (!url) return;
      const ok = await saveSetting(scope, scope_key, url);
      if (!ok) { setError("Failed to save animation setting."); return; }
      invalidateLottieCache();
      await load();
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setUploading((p) => ({ ...p, [key]: false }));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    const ok = await deleteSetting(id);
    if (!ok) { setError("Failed to remove animation."); return; }
    invalidateLottieCache();
    await load();
  }

  // Filtered communities for the per-community section
  const filteredCommunities = communities.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-5 w-5 text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Loading Animations
          </h1>
          <p className="font-body text-xs text-foreground-muted mt-1">
            Lottie animations shown when switching between communities.
            Priority: community → type → universal → spinner.
          </p>
        </div>
        <button
          onClick={load}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          title="Refresh"
        >
          <RefreshCcw size={14} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="font-body text-xs text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)}>
            <X size={13} className="text-red-400" />
          </button>
        </div>
      )}

      {/* ── Universal ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Globe size={14} className="text-accent" />
          <h2 className="font-body text-sm font-semibold text-foreground">Universal</h2>
          <span className="font-body text-[10px] text-foreground-muted">
            — fallback for all communities
          </span>
        </div>
        <AnimationSlot
          label="Universal animation"
          setting={getSetting("universal", "universal")}
          uploading={!!uploading[slotKey("universal", "universal")]}
          onUpload={(f) => handleUpload("universal", "universal", f)}
          onDelete={() => {
            const s = getSetting("universal", "universal");
            return s ? handleDelete(s.id) : Promise.resolve();
          }}
        />
      </section>

      {/* ── Per type ───────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Layers size={14} className="text-accent" />
          <h2 className="font-body text-sm font-semibold text-foreground">Per Type</h2>
          <span className="font-body text-[10px] text-foreground-muted">
            — overrides universal for all communities of that type
          </span>
        </div>
        <div className="space-y-2">
          {TYPE_CONFIG.map(({ key, label, Icon }) => (
            <div key={key} className="flex items-center gap-2">
              <Icon size={13} className="text-foreground-muted shrink-0" />
              <div className="flex-1">
                <AnimationSlot
                  label={label}
                  setting={getSetting("type", key)}
                  uploading={!!uploading[slotKey("type", key)]}
                  onUpload={(f) => handleUpload("type", key, f)}
                  onDelete={() => {
                    const s = getSetting("type", key);
                    return s ? handleDelete(s.id) : Promise.resolve();
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Per community ──────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clapperboard size={14} className="text-accent" />
          <h2 className="font-body text-sm font-semibold text-foreground">Per Community</h2>
          <span className="font-body text-[10px] text-foreground-muted">
            — highest priority, overrides type &amp; universal
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-body text-xs text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {communities.length === 0 ? (
          <p className="font-body text-xs text-foreground-muted py-4 text-center">
            No communities found.
          </p>
        ) : filteredCommunities.length === 0 ? (
          <p className="font-body text-xs text-foreground-muted py-4 text-center">
            No results for &quot;{search}&quot;
          </p>
        ) : (
          <div className="space-y-2">
            {filteredCommunities.map((c) => {
              const typeLabel = TYPE_CONFIG.find((t) => t.key === c.type)?.label ?? c.type;
              return (
                <div key={c.id}>
                  <AnimationSlot
                    label={`${c.name}`}
                    setting={getSetting("community", c.id)}
                    uploading={!!uploading[slotKey("community", c.id)]}
                    onUpload={(f) => handleUpload("community", c.id, f)}
                    onDelete={() => {
                      const s = getSetting("community", c.id);
                      return s ? handleDelete(s.id) : Promise.resolve();
                    }}
                  />
                  <p className="font-body text-[10px] text-foreground-muted ml-[52px] -mt-1">
                    {typeLabel}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
