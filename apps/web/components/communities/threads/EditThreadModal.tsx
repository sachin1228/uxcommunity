"use client";

import { useRef, useState, useEffect } from "react";
import {
  Globe,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CommunityThread, ThreadAttachment, ThreadCategory, ThreadPollDraft } from "./types";
import { THREAD_BODY_MAX_LENGTH } from "./types";
import {
  bodyToTitle,
  serializePollDraft,
  validatePollDraft,
} from "./threadShared";
import {
  CategoryPicker,
  ComposerMedia,
  ComposerTabs,
  PollComposer,
  THREAD_IMAGE_MAX,
  ToggleRow,
  type ThreadComposerTab,
} from "./ThreadComposerControls";
import { compressImage, compressedFile } from "@/lib/image-client";

function pollToDraft(poll: CommunityThread["poll"]): ThreadPollDraft | null {
  if (!poll) return null;
  return { question: poll.question, options: [...poll.options] };
}

interface EditThreadModalProps {
  thread: CommunityThread;
  communityId: string;
  onClose: () => void;
  onUpdated: (thread: CommunityThread) => void;
}

export function EditThreadModal({ thread, communityId, onClose, onUpdated }: EditThreadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  const hasPoll = Boolean(thread.poll);

  const [body,            setBody]            = useState(thread.title);
  const [category,        setCategory]        = useState<ThreadCategory>(thread.category);
  const [attachments,     setAttachments]     = useState<ThreadAttachment[]>(thread.attachments);
  const [tab,             setTab]             = useState<ThreadComposerTab>(hasPoll ? "poll" : "post");
  const [pollRemoved,     setPollRemoved]     = useState(false);
  const [pollDraft,       setPollDraft]       = useState<ThreadPollDraft | null>(() => pollToDraft(thread.poll));
  const [confirmRemovePoll, setConfirmRemovePoll] = useState(false);
  const [allowReplies,    setAllowReplies]    = useState(thread.allow_replies);
  const [isPublic,        setIsPublic]        = useState(thread.is_public ?? false);
  const [uploading,       setUploading]       = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const images = attachments.filter((a) => a.type.startsWith("image/"));

  // Once the poll has been removed the thread is a plain post — keep the Post
  // composer on screen so the tab switcher can't re-add the deleted poll.
  const selectedTab: ThreadComposerTab = pollRemoved ? "post" : tab;
  const showTabs = hasPoll && !pollRemoved;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const newImages = files.filter((file) => file.type.startsWith("image/"));
    if (newImages.length > 0 && images.length + newImages.length > THREAD_IMAGE_MAX) {
      setError(`You can add up to ${THREAD_IMAGE_MAX} images.`);
      return;
    }
    if (attachments.length + files.length > 5) {
      setError("You can add up to 5 attachments.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded: ThreadAttachment[] = [];
      for (const file of files) {
        const formData = new FormData();
        let payload = file;
        // Animated GIFs pass through untouched — compressing them would flatten
        // the animation into a static frame.
        if (file.type.startsWith("image/") && file.type !== "image/gif") {
          try { payload = compressedFile(await compressImage(file), file); } catch { /* keep original */ }
        }
        formData.append("file", payload);
        const response = await fetch(`/api/communities/${communityId}/threads/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Upload failed.");
        uploaded.push(data.attachment as ThreadAttachment);
      }
      setAttachments((c) => [...c, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function requestTab(next: ThreadComposerTab) {
    if (next === selectedTab) return;
    // Removing an existing poll deletes its votes — ask first.
    if (hasPoll && !pollRemoved && next === "post") {
      setConfirmRemovePoll(true);
      return;
    }
    setTab(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    let title: string;
    let poll: { question: string; options: string[] } | null;

    if (pollRemoved || selectedTab === "post") {
      if (!body.trim()) {
        setError("Write something before saving.");
        return;
      }
      title = bodyToTitle(body);
      poll = null;
    } else {
      if (!pollDraft) {
        setError("Add a question for your poll.");
        return;
      }
      const invalid = validatePollDraft(pollDraft);
      if (invalid) {
        setError(invalid);
        return;
      }
      const serialized = serializePollDraft(pollDraft);
      const pollIsContent = thread.title.trim() === thread.poll?.question.trim();
      // Polls created as standalone posts use the question as the thread text;
      // keep any separate caption on older threads untouched.
      title = pollIsContent ? serialized.question : thread.title;
      poll = serialized;
    }

    const extractedLinks = [...new Set(body.match(/https?:\/\/[^\s<>"]+/g) ?? [])];
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/communities/${communityId}/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          tags: thread.tags,
          attachments,
          links: extractedLinks,
          allow_replies: allowReplies,
          is_public: isPublic,
          poll,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update thread.");
      onUpdated({
        ...thread,
        ...(data.thread as CommunityThread),
        users: thread.users,
        like_count: thread.like_count,
        user_liked: thread.user_liked,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update thread.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-thread-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[min(800px,80vh)] w-full max-w-[540px] flex-col overflow-hidden rounded-xl bg-surface shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_24px_70px_-20px_rgba(0,0,0,0.45)]"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-2 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2 id="edit-thread-title" className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
              Edit Thread
            </h2>
            <p className="mt-1 font-body text-[13px] text-foreground-muted">
              Update the content, poll, images, or privacy of this thread
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
            <X strokeWidth={2.5} size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-4 sm:px-6">
          {/* ── Post / Poll tabs (only when the thread already has a poll) ── */}
          {showTabs && <ComposerTabs value={selectedTab} onChange={requestTab} />}

          {/* ── Composer body / poll composer ── */}
          {selectedTab === "post" ? (
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={THREAD_BODY_MAX_LENGTH}
                placeholder="What do you want to talk about?"
                rows={4}
                className="field w-full resize-none overflow-hidden pb-6 pr-16 pt-3"
              />
              <span className="pointer-events-none absolute bottom-2 right-3 font-body text-[11px] tabular-nums text-foreground-subtle">
                {body.length}/{THREAD_BODY_MAX_LENGTH}
              </span>
            </div>
          ) : (
            pollDraft && (
              <PollComposer value={pollDraft} onChange={setPollDraft} />
            )
          )}

          {/* ── Images / files (available for both posts and polls) ── */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,application/zip,text/plain"
            className="hidden"
            onChange={handleFiles}
          />
          <ComposerMedia
            attachments={attachments}
            uploading={uploading}
            onRemove={(url) => setAttachments((c) => c.filter((a) => a.url !== url))}
            onAddMore={() => fileInputRef.current?.click()}
          />

          {/* ── Category ── */}
          <CategoryPicker value={category} onChange={setCategory} />

          {/* ── Toggles ── */}
          <div className="divide-y divide-border">
            <ToggleRow
              title="Allow replies"
              description="Other members can reply to this thread."
              checked={allowReplies}
              onChange={setAllowReplies}
            />
            <ToggleRow
              title="Share publicly"
              description="Visible to everyone, not just community members."
              checked={isPublic}
              onChange={setIsPublic}
              icon={<Globe strokeWidth={2.5} size={15} />}
            />
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="shrink-0 px-5 pb-1 sm:px-6">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="font-body text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3 sm:px-6">
          <button type="button" onClick={onClose} className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 font-body text-[13px] font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 font-body text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Spinner size={14} className="text-white" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>

    {confirmRemovePoll && (
      <ConfirmDialog
        open={confirmRemovePoll}
        onClose={() => setConfirmRemovePoll(false)}
        onConfirm={() => {
          setPollRemoved(true);
          setTab("post");
          setPollDraft(null);
          setConfirmRemovePoll(false);
        }}
        title="Remove poll?"
        message="Removing the poll deletes it and all its votes from this thread. You can keep the post text and save it as a regular thread instead."
        confirmLabel="Remove poll"
      />
    )}
    </ModalPortal>
  );
}
