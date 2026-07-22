"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search, X, ChevronRight, ImagePlus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { AddItemModal } from "@/components/admin/masterData/AddItemModal";

export interface MasterItem {
  id: string;
  name: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Module-level cache ───────────────────────────────────────────────────────
// Keyed by apiBase (e.g. "/api/admin/cities"). Survives SPA navigations so
// returning to a master-data page renders instantly without a spinner.
// Master data changes infrequently — 5 minutes TTL is safe.
const MASTER_CACHE_TTL = 5 * 60_000;

const masterCache = new Map<string, { data: MasterItem[]; fetchedAt: number }>();
const masterInflight = new Map<string, Promise<MasterItem[]>>();

/**
 * Exported so that MasterItemDetail can invalidate the list cache after a
 * successful delete or PATCH — ensuring the list re-fetches on next visit
 * instead of showing stale data.
 */
export function invalidateMasterCache(apiBase: string): void {
  masterCache.delete(apiBase);
}

interface MasterDataPageProps {
  title: string;
  entity: string;
  apiBase: string;
  basePath: string;
  /** Key to pull the array from the API response. Defaults to auto-detect. */
  responseKey?: string;
  /** Hides the Add button and empty-state CTA (for fixed enums like experience levels). */
  readOnly?: boolean;
}

export function MasterDataPage({
  title,
  entity,
  apiBase,
  basePath,
  responseKey,
  readOnly,
}: MasterDataPageProps) {
  const router = useRouter();
  // Seed from cache synchronously — no spinner flash on revisit.
  const [items, setItems] = useState<MasterItem[]>(
    () => masterCache.get(apiBase)?.data ?? []
  );
  const [loading, setLoading] = useState(() => {
    const c = masterCache.get(apiBase);
    return !c || Date.now() - c.fetchedAt >= MASTER_CACHE_TTL;
  });
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async (force = false) => {
    // Serve from cache if fresh — no spinner, instant render.
    const cached = masterCache.get(apiBase);
    if (!force && cached && Date.now() - cached.fetchedAt < MASTER_CACHE_TTL) {
      setItems(cached.data);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent fetches (e.g. StrictMode double-mount).
    const inflight = masterInflight.get(apiBase);
    if (inflight) {
      const rows = await inflight;
      setItems(rows);
      setLoading(false);
      return;
    }

    setLoading(true);
    const p = fetch(`${apiBase}?all=true`)
      .then(async (res) => {
        if (!res.ok) return [];
        const data = await res.json();
        return (
          responseKey
            ? (data[responseKey] ?? [])
            : (data.companies ??
               data.cities ??
               data.sectors ??
               data.interests ??
               data.experience_levels ??
               [])
        ) as MasterItem[];
      })
      .catch(() => [] as MasterItem[])
      .finally(() => masterInflight.delete(apiBase));

    masterInflight.set(apiBase, p);

    const rows = await p;
    masterCache.set(apiBase, { data: rows, fetchedAt: Date.now() });
    setItems(rows);
    setLoading(false);
  }, [apiBase, responseKey]);

  useEffect(() => { load(); }, [load]);

  const tabItems = useMemo(
    () => items.filter((i) => (activeTab === "active" ? i.is_active : !i.is_active)),
    [items, activeTab]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tabItems.filter((i) => i.name.toLowerCase().includes(q)) : tabItems;
  }, [tabItems, search]);

  function handleAdded() {
    setModalOpen(false);
    masterCache.delete(apiBase);
    load(true);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
        {!readOnly && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            <Plus size={13} />
            Add {entity}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-border">
        {(["active", "inactive"] as const).map((tab) => {
          const count = items.filter((i) => (tab === "active" ? i.is_active : !i.is_active)).length;
          return (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearch(""); }}
              className={`px-4 py-2 font-body text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {tab}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                activeTab === tab
                  ? "bg-accent/15 text-accent"
                  : "bg-surface-raised text-foreground-muted"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full rounded-lg border border-border bg-surface pl-8 pr-8 py-2 font-body text-xs text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
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

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="font-body text-xs text-foreground-muted">
              No {entity.toLowerCase()}s yet.
            </p>
            {!readOnly && (
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
              >
                <Plus size={13} />Add your first {entity.toLowerCase()}
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            No results for &quot;{search}&quot;
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider w-8" />
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 w-6" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr
                  key={item.id}
                  onClick={() => router.push(`${basePath}/${item.id}`)}
                  className={`cursor-pointer ${
                    idx < filtered.length - 1 ? "border-b border-white/5" : ""
                  } hover:bg-surface-raised transition-colors`}
                >
                  <td className="px-4 py-2">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-6 w-6 rounded object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-surface-raised flex items-center justify-center">
                        <ImagePlus size={11} className="text-foreground-muted" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`font-body text-xs ${
                        item.is_active
                          ? "text-foreground"
                          : "text-foreground-muted line-through"
                      }`}
                    >
                      {item.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        item.is_active
                          ? "bg-green-500/10 text-green-400"
                          : "bg-surface-raised text-foreground-muted"
                      }`}
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 w-6">
                    <ChevronRight size={13} className="text-foreground-muted" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      {!loading && tabItems.length > 0 && (
        <p className="mt-2 text-right font-body text-[10px] text-foreground-muted">
          {search ? `${filtered.length} of ${tabItems.length}` : tabItems.length}{" "}
          {entity.toLowerCase()}{tabItems.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Add Modal */}
      {modalOpen && (
        <AddItemModal
          entity={entity}
          apiBase={apiBase}
          onClose={() => setModalOpen(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
