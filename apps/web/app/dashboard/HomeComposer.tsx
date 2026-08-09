"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  Globe,
  Link2,
  Loader2,
  MessageSquare,
  Users,
} from "lucide-react";
import { CreateEventModal } from "@/components/communities/events/CreateEventModal";
import type { CommunityEvent } from "@/components/communities/events/types";
import { CreateResourceModal } from "@/components/communities/resources/CreateResourceModal";
import type { CommunityResource } from "@/components/communities/resources/types";
import { CreateThreadModal } from "@/components/communities/threads/CreateThreadModal";
import type { CommunityThread } from "@/components/communities/threads/types";

type ComposerType = "thread" | "event" | "resource" | null;
type Audience = "public" | string;

interface CommunityOption {
  id: string;
  name: string;
  type: string;
  is_private?: boolean;
}

export function HomeComposer() {
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState<Audience>("public");
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [modal, setModal] = useState<ComposerType>(null);

  useEffect(() => {
    fetch("/api/communities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.communities) setCommunities(data.communities);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const generalCommunity = useMemo(
    () => communities.find((community) => community.type === "general"),
    [communities],
  );
  const selectedCommunity = communities.find((community) => community.id === audience);
  const targetCommunityId = audience === "public" ? generalCommunity?.id : audience;
  const isPublic = audience === "public";

  function openComposer(type: Exclude<ComposerType, null>) {
    if (!targetCommunityId) return;
    setModal(type);
  }

  function closeComposer() {
    setModal(null);
  }

  function notifyFeed() {
    window.dispatchEvent(new Event("home-feed-refresh"));
  }

  const audienceLabel = isPublic
    ? "Everyone on UX Community"
    : selectedCommunity?.name ?? "Choose a community";

  return (
    <>
      <section className="mx-6 mb-6 overflow-visible rounded-2xl border border-border bg-surface shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-foreground">Share something</h2>
            <p className="mt-0.5 font-body text-xs text-foreground-muted">
              Start a conversation, share a resource, or invite people to an event.
            </p>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setAudienceOpen((open) => !open)}
              disabled={loading}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/50 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
              aria-haspopup="listbox"
              aria-expanded={audienceOpen}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isPublic ? (
                <Globe size={14} className="shrink-0 text-accent" />
              ) : (
                <Users size={14} className="shrink-0 text-accent" />
              )}
              <span className="max-w-48 truncate">{audienceLabel}</span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${audienceOpen ? "rotate-180" : ""}`} />
            </button>

            {audienceOpen && (
              <div
                role="listbox"
                className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isPublic}
                  onClick={() => {
                    setAudience("public");
                    setAudienceOpen(false);
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised ${isPublic ? "bg-accent/10" : ""}`}
                >
                  <Globe size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span>
                    <span className="block font-body text-sm font-medium text-foreground">Everyone on UX Community</span>
                    <span className="mt-0.5 block font-body text-xs text-foreground-muted">Publish to the home feed for all members.</span>
                  </span>
                </button>

                {communities.length > 0 && (
                  <div className="border-t border-border">
                    <p className="px-4 pb-1 pt-3 font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
                      Share with a specific community
                    </p>
                    {communities.map((community) => {
                      const selected = audience === community.id;
                      return (
                        <button
                          key={community.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setAudience(community.id);
                            setAudienceOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised ${selected ? "bg-accent/10" : ""}`}
                        >
                          {community.is_private ? (
                            <Users size={15} className="shrink-0 text-foreground-muted" />
                          ) : (
                            <Users size={15} className="shrink-0 text-foreground-subtle" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">{community.name}</span>
                          {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => openComposer("thread")}
            disabled={!targetCommunityId}
            className="group flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <MessageSquare size={17} />
            </span>
            <span>
              <span className="block font-body text-sm font-medium text-foreground">Create thread</span>
              <span className="block font-body text-xs text-foreground-muted">Ask or discuss</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => openComposer("event")}
            disabled={!targetCommunityId}
            className="group flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <CalendarPlus size={17} />
            </span>
            <span>
              <span className="block font-body text-sm font-medium text-foreground">Create event</span>
              <span className="block font-body text-xs text-foreground-muted">Bring people together</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => openComposer("resource")}
            disabled={!targetCommunityId}
            className="group flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Link2 size={17} />
            </span>
            <span>
              <span className="block font-body text-sm font-medium text-foreground">Share resource</span>
              <span className="block font-body text-xs text-foreground-muted">Pass along something useful</span>
            </span>
          </button>
        </div>
      </section>

      {modal === "thread" && targetCommunityId && (
        <CreateThreadModal
          communityId={targetCommunityId}
          initialIsPublic={isPublic}
          onClose={closeComposer}
          onCreated={(_thread: CommunityThread) => notifyFeed()}
        />
      )}
      {modal === "event" && targetCommunityId && (
        <CreateEventModal
          communityId={targetCommunityId}
          initialIsPublic={isPublic}
          onClose={closeComposer}
          onCreated={(_event: CommunityEvent) => notifyFeed()}
        />
      )}
      {modal === "resource" && targetCommunityId && (
        <CreateResourceModal
          communityId={targetCommunityId}
          initialIsPublic={isPublic}
          onClose={closeComposer}
          onCreated={(_resource: CommunityResource) => notifyFeed()}
        />
      )}
    </>
  );
}