"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  MessageSquarePlus,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Modal } from "@/components/ui/Modal";
import { CreateEventModal } from "@/components/communities/events/CreateEventModal";
import { CreateResourceModal } from "@/components/communities/resources/CreateResourceModal";
import { CreateThreadModal } from "@/components/communities/threads/CreateThreadModal";

type PostType = "thread" | "resource" | "event";

interface CommunityOption {
  id: string;
  name: string;
  image_url: string | null;
  enabled_tabs?: string[];
}

interface HomePostComposerProps {
  name: string;
  avatarUrl: string | null;
  onCreated: () => void;
}

const postTypes: Array<{
  type: PostType;
  label: string;
  description: string;
  icon: typeof MessageSquarePlus;
  color: string;
}> = [
  {
    type: "thread",
    label: "Thread",
    description: "Start a discussion or ask a question",
    icon: MessageSquarePlus,
    color: "text-accent",
  },
  {
    type: "resource",
    label: "Resource",
    description: "Share a useful link with the community",
    icon: BookOpen,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    type: "event",
    label: "Event",
    description: "Invite members to something happening",
    icon: CalendarDays,
    color: "text-orange-600 dark:text-orange-400",
  },
];

export function HomePostComposer({ name, avatarUrl, onCreated }: HomePostComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [postType, setPostType] = useState<PostType>("thread");
  const [communityId, setCommunityId] = useState("");
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);

  const selectedCommunity = communities.find((community) => community.id === communityId);

  useEffect(() => {
    if (!pickerOpen || communities.length) return;
    fetch("/api/communities", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const nextCommunities = (data?.communities ?? []) as CommunityOption[];
        setCommunities(nextCommunities);
        if (nextCommunities.length) setCommunityId((current) => current || nextCommunities[0].id);
        if (!nextCommunities.length) setCommunityError("Join a community before creating a post.");
      })
      .catch(() => setCommunityError("We couldn't load your communities. Please try again."))
      .finally(() => setLoadingCommunities(false));
  }, [pickerOpen, communities.length]);

  function openPicker(type: PostType = "thread") {
    setPostType(type);
    if (!communities.length) setLoadingCommunities(true);
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    setEditorOpen(false);
    setCommunityError(null);
  }

  function handleCreated() {
    closePicker();
    onCreated();
  }

  return (
    <>
      <section className="mx-6 mb-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-3 p-4 sm:p-5">
          <AvatarImg url={avatarUrl} name={name} size={44} className="shrink-0" />
          <button
            type="button"
            onClick={() => openPicker()}
            className="flex h-12 flex-1 items-center rounded-full border border-border px-5 text-left font-body text-base font-medium text-foreground-muted transition-colors hover:border-accent hover:text-foreground"
          >
            Start a post
          </button>
        </div>
        <div className="grid grid-cols-3 border-t border-border px-2 py-2 sm:px-4 sm:py-3">
          {postTypes.map(({ type, label, icon: Icon, color }) => (
            <button
              key={type}
              type="button"
              onClick={() => openPicker(type)}
              className="flex items-center justify-center gap-2 rounded-lg py-2.5 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground sm:text-base"
            >
              <Icon size={20} className={color} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <Modal
        open={pickerOpen}
        onClose={closePicker}
        title="Create a post"
        maxWidth="max-w-lg"
        panelClassName="p-6"
      >
        <div className="space-y-5">
          <div>
            <p className="mb-2 font-body text-xs font-medium uppercase tracking-wider text-foreground-muted">
              What would you like to share?
            </p>
            <div className="grid gap-2">
              {postTypes.map(({ type, label, description, icon: Icon, color }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPostType(type)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    postType === type
                      ? "border-accent bg-accent/10"
                      : "border-border hover:bg-surface-raised"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-surface-raised ${color}`}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-body text-sm font-medium text-foreground">{label}</span>
                    <span className="block font-body text-xs text-foreground-muted">{description}</span>
                  </span>
                  <span className={`h-4 w-4 rounded-full border ${postType === type ? "border-accent bg-accent ring-2 ring-accent/20" : "border-border"}`} />
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block font-body text-xs font-medium uppercase tracking-wider text-foreground-muted">
              Post in
            </span>
            <span className="relative block">
              <select
                value={communityId}
                onChange={(event) => setCommunityId(event.target.value)}
                disabled={loadingCommunities || !communities.length}
                className="h-11 w-full appearance-none rounded-lg border border-border bg-surface-raised px-3 pr-10 font-body text-sm text-foreground outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingCommunities && <option>Loading communities…</option>}
                {!loadingCommunities && !communities.length && <option>No communities available</option>}
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>{community.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-foreground-muted" />
            </span>
          </label>

          {communityError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
              {communityError}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={closePicker}
              className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedCommunity || loadingCommunities}
              onClick={() => {
                setPickerOpen(false);
                setEditorOpen(true);
              }}
              className="rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </div>
      </Modal>

      {communityId && postType === "thread" && editorOpen && (
        <CreateThreadModal
          communityId={communityId}
          initialIsPublic
          onClose={closePicker}
          onCreated={handleCreated}
        />
      )}
      {communityId && postType === "resource" && editorOpen && (
        <CreateResourceModal
          communityId={communityId}
          initialIsPublic
          onClose={closePicker}
          onCreated={handleCreated}
        />
      )}
      {communityId && postType === "event" && editorOpen && (
        <CreateEventModal
          communityId={communityId}
          initialIsPublic
          onClose={closePicker}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}