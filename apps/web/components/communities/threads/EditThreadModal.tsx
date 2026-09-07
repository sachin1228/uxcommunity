"use client";

import { useRef, useState, useEffect } from "react";
import {
  Globe,
  Image as ImageIcon,
  MessageCircle,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import type { CommunityThread, ThreadPollDraft, ThreadCategory } from "./types";
import { THREAD_BODY_MAX_LENGTH } from "./types";
import {
  bodyToTitle,
  serializePollDraft,
  validatePollDraft,
} from "./threadShared";
import {
  CategoryPicker,
  ComposerMedia,
  PollComposer,
  ToggleRow,
} from "./ThreadComposerControls";
import { useThreadFileUpload } from "./useThreadFileUpload";

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
  const [pollDraft,       setPollDraft]       = useState<ThreadPollDraft | null>(() => pollToDraft(thread.poll));
  const [category,        setCategory]        = useState<ThreadCategory>(thread.category);
  const [allowReplies,    setAllowReplies]    = useState(thread.allow_replies);
  const [isPublic,        setIsPublic]        = useState(thread.is_public ?? false);
  const [saving,          setSaving]          = useState(false);

  const {
    attachments,
    removeAttachment,
    uploading,
    error,
    setError,
    addFiles,
    dropHandlers,
    isDragging,
  } = useThreadFileUpload({ communityId, initialAttachments: thread.attachments });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  // The hidden file input and drag-and-drop share the same intake path.
  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    let title: string;
    let poll: { question: string; options: string[] } | null;

    if (!hasPoll) {
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
        {...dropHandlers}
        className="modal-panel relative flex max-h-[min(800px,80vh)] w-full max-w-[600px] flex-col overflow-hidden"
      >
        {/* Modal body — scrolls; the header lives inside it like the Geist modal */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-5">
          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="edit-thread-title" className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
                Edit Thread
              </h2>
              <p className="mt-1 font-body text-[13px] text-foreground-muted">
                Update the content, poll, images, or privacy of this thread
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
              <X strokeWidth={2.5} size={16} />
            </button>
          </div>

          {/* ── Composer — editing keeps the thread type: posts edit the text,
               polls edit the poll only ── */}
          {hasPoll ? (
            pollDraft && (
              <PollComposer value={pollDraft} onChange={setPollDraft} />
            )
          ) : (
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
          )}

          {/* ── Images / files ── */}
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
            onRemove={removeAttachment}
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
              icon={<MessageCircle strokeWidth={2.5} size={15} />}
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
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
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

        {/* Drag-and-drop overlay — shown while files hover over the modal. */}
        {isDragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-accent bg-accent/10"
          >
            <div className="flex flex-col items-center gap-2">
              <ImageIcon strokeWidth={2.5} size={22} className="text-accent" />
              <span className="font-body text-sm font-medium text-accent">
                Drop images or files to attach
              </span>
            </div>
          </div>
        )}
      </form>
    </div>
    </ModalPortal>
  );
}
