"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  MessageSquarePlus,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CreateEventModal } from "@/components/communities/events/CreateEventModal";
import { CreateResourceModal } from "@/components/communities/resources/CreateResourceModal";
import { CreateThreadModal } from "@/components/communities/threads/CreateThreadModal";

type PostType = "thread" | "resource" | "event";

interface CommunityOption {
  id: string;
  name: string;
  image_url: string | null;
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [postType, setPostType] = useState<PostType>("thread");
  const [communityId, setCommunityId] = useState("");
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/communities", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const nextCommunities = (data?.communities ?? []) as CommunityOption[];
        setCommunities(nextCommunities);
        if (nextCommunities.length) setCommunityId((current) => current || nextCommunities[0].id);
        if (!nextCommunities.length) setCommunityError("Join a community before creating a post.");
      })
      .catch(() => setCommunityError("We couldn't load your communities. Please try again."))
  }, []);

  function openEditor(type: PostType) {
    setPostType(type);
    if (communityId) {
      setCommunityError(null);
      setEditorOpen(true);
    } else if (!communities.length) {
      setCommunityError("Join a community before creating a post.");
    }
  }

  function closeEditor() {
    setEditorOpen(false);
    setCommunityError(null);
  }

  function handleCreated() {
    closeEditor();
    onCreated();
  }

  return (
    <>
      <section className="mx-6 mb-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="grid grid-cols-[auto_1fr] items-center gap-3 p-4 sm:p-5">
          <AvatarImg url={avatarUrl} name={name} size={44} className="shrink-0" />
          <div className="grid min-w-0 grid-cols-3 gap-1">
            {postTypes.map(({ type, label, icon: Icon, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => openEditor(type)}
                className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 py-2.5 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground sm:gap-2 sm:px-2 sm:text-base"
              >
                <Icon size={20} className={color} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>
        {communityError && (
          <p className="border-t border-border px-4 py-2.5 font-body text-xs text-red-400">
            {communityError}
          </p>
        )}
      </section>

      {communityId && postType === "thread" && editorOpen && (
        <CreateThreadModal
          communityId={communityId}
          initialIsPublic
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
      {communityId && postType === "resource" && editorOpen && (
        <CreateResourceModal
          communityId={communityId}
          initialIsPublic
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
      {communityId && postType === "event" && editorOpen && (
        <CreateEventModal
          communityId={communityId}
          initialIsPublic
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}