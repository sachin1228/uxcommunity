"use client";

import { useState, useEffect, useCallback } from "react";
import { Clapperboard, RefreshCcw, X, Layers, Sparkles, TrendingUp, Globe, MapPin, Building2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { invalidateLottieCache } from "@/components/ui/LottieLoader";
import { AnimationSlot, type LottieSetting } from "@/components/admin/lottie/AnimationSlot";
import { uploadLottieFile, saveLottieSetting, deleteLottieSetting } from "@/components/admin/lottie/lottieApi";

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

interface Community {
  id: string;
  name: string;
  type: string;
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

  function slotKey(scope: string, scope_key: string) {
    return `${scope}:${scope_key}`;
  }

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
      const ok = await saveLottieSetting(scope, scope_key, url);
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
    const ok = await deleteLottieSetting(id);
    if (!ok) { setError("Failed to remove animation."); return; }
    invalidateLottieCache();
    await load();
  }

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
              const typeLabel =
                TYPE_CONFIG.find((t) => t.key === c.type)?.label ?? c.type;
              return (
                <div key={c.id}>
                  <AnimationSlot
                    label={c.name}
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
