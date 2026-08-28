"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CreateThreadModal } from "@/components/communities/threads/CreateThreadModal";
import { communityFeedLayout } from "@/components/communities/feed-layout";

interface HomePostComposerProps {
  name: string;
  avatarUrl: string | null;
  onCreated: () => void;
}

export function HomePostComposer({ name, avatarUrl, onCreated }: HomePostComposerProps) {
  const [editorOpen, setEditorOpen] = useState(false);

  function handleCreated() {
    setEditorOpen(false);
    onCreated();
  }

  return (
    <>
      <section className="my-1">
        <div className={`${communityFeedLayout.card} flex flex-col gap-4`}>
          <div className="flex items-center gap-3">
            <AvatarImg url={avatarUrl} name={name} size={40} className="shrink-0 rounded-full" />
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-semibold text-foreground">{name}</p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 font-body text-xs text-foreground-subtle">
                <Globe size={12} /> Public feed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            aria-label="Start a public post"
            className="flex min-h-11 w-full items-center rounded-xl border border-border bg-surface-raised px-4 text-left font-body text-sm text-foreground-muted transition-colors hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span>What do you want to talk about?</span>
          </button>
        </div>
      </section>

      {editorOpen && (
        <CreateThreadModal
          publicOnly
          name={name}
          avatarUrl={avatarUrl}
          onClose={() => setEditorOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
