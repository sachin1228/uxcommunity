"use client";

import { useState } from "react";
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
      <section className={`${communityFeedLayout.gutters} my-1`}>
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 sm:px-5 sm:py-4">
          <AvatarImg url={avatarUrl} name={name} size={40} className="shrink-0 rounded-full" />
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="flex min-h-12 flex-1 items-center rounded-full border border-border-strong bg-surface-raised px-5 text-left font-body text-sm text-foreground-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            <span>Start a post</span>
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
