"use client";

import { useState } from "react";
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
      <section className="mx-6 mb-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="grid grid-cols-[auto_1fr] items-center gap-2.5 p-3 sm:p-4">
          <AvatarImg url={avatarUrl} name={name} size={38} className="shrink-0 rounded-full" />
          <div className="grid min-w-0 grid-cols-3 gap-0.5">
            {postTypes.map(({ type, label, icon: Icon, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => openEditor(type)}
                className="flex min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-2 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground sm:gap-1.5 sm:px-2 sm:text-base"
              >
                <Icon size={20} className={color} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

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