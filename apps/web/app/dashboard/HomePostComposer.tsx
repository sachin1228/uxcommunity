"use client";

import { useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Palette,
  Plus,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CreateEventModal } from "@/components/communities/events/CreateEventModal";
import { CreateResourceModal } from "@/components/communities/resources/CreateResourceModal";
import { CreateShowcaseModal } from "@/components/communities/showcase/CreateShowcaseModal";
import { CreateThreadModal } from "@/components/communities/threads/CreateThreadModal";
import { communityFeedLayout } from "@/components/communities/feed-layout";

type PostType = "showcase" | "thread" | "resource" | "event";

interface HomePostComposerProps {
  name: string;
  avatarUrl: string | null;
  onCreated: () => void;
}

const postTypes: Array<{
  type: PostType;
  label: string;
  description: string;
  icon: typeof Plus;
  color: string;
}> = [
  {
    type: "showcase",
    label: "Create Showcase",
    description: "Share your work with the community",
    icon: Palette,
    color: "text-violet-600 dark:text-violet-400",
  },
  {
    type: "thread",
    label: "Create Thread",
    description: "Start a discussion or ask a question",
    icon: Plus,
    color: "text-accent",
  },
  {
    type: "resource",
    label: "Create Resource",
    description: "Share a useful link with the community",
    icon: BookOpen,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    type: "event",
    label: "Create Event",
    description: "Invite members to something happening",
    icon: CalendarDays,
    color: "text-orange-600 dark:text-orange-400",
  },
];

export function HomePostComposer({ name, avatarUrl, onCreated }: HomePostComposerProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [postType, setPostType] = useState<PostType>("thread");

  function openEditor(type: PostType) {
    setPostType(type);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
  }

  function handleCreated() {
    closeEditor();
    onCreated();
  }

  return (
    <>
      <section className={`${communityFeedLayout.gutters} my-1`}>
        <div className="grid grid-cols-[auto_1fr] items-center gap-2.5 py-3 sm:py-4">
          <AvatarImg url={avatarUrl} name={name} size={38} className="shrink-0 rounded-full" />
          <div className="grid min-w-0 grid-cols-4 justify-items-center gap-0.5">
            {postTypes.map(({ type, label, icon: Icon, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => openEditor(type)}
                className="flex w-fit min-w-0 items-center justify-self-center gap-1 rounded-lg px-3.5 py-2.5 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground sm:gap-1.5"
              >
                <Icon size={20} className={color} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {postType === "showcase" && editorOpen && (
        <CreateShowcaseModal
          publicOnly
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
      {postType === "thread" && editorOpen && (
        <CreateThreadModal
          publicOnly
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
      {postType === "resource" && editorOpen && (
        <CreateResourceModal
          publicOnly
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
      {postType === "event" && editorOpen && (
        <CreateEventModal
          publicOnly
          onClose={closeEditor}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
