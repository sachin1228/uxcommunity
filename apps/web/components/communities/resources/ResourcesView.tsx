"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { CreateResourceModal } from "./CreateResourceModal";
import { ResourceCard } from "./ResourceCard";

type FilterType = "all" | CommunityResource["resource_type"];

export function ResourcesView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [resources, setResources] = useState<CommunityResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const fetchResources = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load resources.");
      setResources(data.resources as CommunityResource[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resources.");
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void fetchResources();
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const channel = supabase
      .channel(`community-resources:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "community_resources",
        filter: `community_id=eq.${communityId}`,
      }, () => void fetchResources(true))
      .subscribe();

    const saveChannel = supabase
      .channel(`resource-saves:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "resource_saves",
      }, (payload) => {
        const record = (payload.new ?? payload.old) as { resource_id?: string; user_id?: string } | null;
        if (!record?.resource_id) return;
        if (record.user_id === currentUserId) return;
        const resourceId = record.resource_id;
        setResources((prev) =>
          prev.map((r) => {
            if (r.id !== resourceId) return r;
            if (payload.eventType === "INSERT") return { ...r, save_count: r.save_count + 1 };
            if (payload.eventType === "DELETE") return { ...r, save_count: Math.max(0, r.save_count - 1) };
            return r;
          }),
        );
      })
      .subscribe();

    const handleFocus = () => { if (document.visibilityState === "visible") void fetchResources(true); };
    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("focus", handleFocus);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(saveChannel);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [communityId, currentUserId, fetchResources]);

  function handleCreated(resource: CommunityResource) {
    setResources((prev) => [resource, ...prev.filter((r) => r.id !== resource.id)]);
  }

  function handleUpdated(updated: CommunityResource) {
    setResources((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  function handleSaveChanged(resourceId: string, saved: boolean, newCount: number) {
    setResources((prev) =>
      prev.map((r) => r.id === resourceId ? { ...r, user_saved: saved, save_count: newCount } : r),
    );
  }

  function handleBookmarkChanged(resourceId: string, bookmarked: boolean, newCount: number) {
    setResources((prev) =>
      prev.map((r) => r.id === resourceId ? { ...r, user_bookmarked: bookmarked, bookmark_count: newCount } : r),
    );
  }

  function handleDeleted(resourceId: string) {
    setResources((prev) => prev.filter((r) => r.id !== resourceId));
  }

  // Derive which type filters have results
  const typesWithData = new Set(resources.map((r) => r.resource_type));
  const filtered = filter === "all" ? resources : resources.filter((r) => r.resource_type === filter);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Resources</h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Figma files, articles, tools, and more — shared by your community.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={16} /> Share Resource
          </button>
        </div>

        {/* Type filter tabs */}
        {!loading && resources.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full border px-3 py-1.5 font-body text-xs transition-colors ${
                filter === "all"
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border text-foreground-muted hover:border-accent/40 hover:text-foreground"
              }`}
            >
              All
              <span className="ml-1.5 font-mono text-[10px]">{resources.length}</span>
            </button>
            {RESOURCE_TYPES.filter((t) => typesWithData.has(t.value)).map((t) => {
              const count = resources.filter((r) => r.resource_type === t.value).length;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFilter(t.value)}
                  className={`rounded-full border px-3 py-1.5 font-body text-xs transition-colors ${
                    filter === t.value
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-foreground-muted hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchResources()} className="font-body text-xs text-red-300 underline">
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 rounded-full bg-surface-raised" />
                  <div className="h-5 w-5 rounded bg-surface-raised" />
                </div>
                <div className="mt-3 h-4 w-2/3 rounded bg-surface-raised" />
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-surface-raised" />
                  <div className="h-2.5 w-16 rounded bg-surface-raised" />
                  <div className="h-2.5 w-12 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <BookMarked size={28} className="mx-auto text-foreground-subtle" />
            <h3 className="mt-3 font-display text-base font-semibold text-foreground">No resources yet</h3>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Be the first to share a Figma file, article, tool, or anything useful.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <BookMarked size={28} className="mx-auto text-foreground-subtle" />
            <h3 className="mt-3 font-display text-base font-semibold text-foreground">No resources in this category</h3>
            <p className="mt-1 font-body text-sm text-foreground-muted">Try a different filter or share one yourself.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                currentUserId={currentUserId}
                communityId={communityId}
                onUpdated={handleUpdated}
                onSaveChanged={handleSaveChanged}
                onBookmarkChanged={handleBookmarkChanged}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateResourceModal
          communityId={communityId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
