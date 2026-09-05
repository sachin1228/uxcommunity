"use client";

import { useRef, useState, useEffect } from "react";
import {
  BarChart3,
  Globe,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import type { CommunityThread, ThreadAttachment, ThreadCategory, ThreadPollDraft } from "./types";
import { THREAD_BODY_MAX_LENGTH } from "./types";
import {
  bodyToTitle,
  isPollDraftEmpty,
  serializePollDraft,
  validatePollDraft,
} from "./threadShared";
import {
  CategoryPicker,
  ComposerToolButton,
  FileAttachmentList,
  ImageAttachmentsRow,
  PollComposer,
  TagPicker,
  THREAD_IMAGE_MAX,
  ToggleRow,
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

  const [body,            setBody]            = useState(thread.title);
  const [category,        setCategory]        = useState<ThreadCategory>(thread.category);
  const [tags,            setTags]            = useState<string[]>(thread.tags);
  const [attachments,     setAttachments]     = useState<ThreadAttachment[]>(thread.attachments);
  const [activeTool,      setActiveTool]      = useState<"photo" | "poll">(thread.poll ? "poll" : "photo");
  const [pollDraft,       setPollDraft]       = useState<ThreadPollDraft | null>(() => pollToDraft(thread.poll));
  const [allowReplies,    setAllowReplies]    = useState(thread.allow_replies);
  const [isPublic,        setIsPublic]        = useState(thread.is_public ?? false);
  const [uploading,       setUploading]       = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const images    = attachments.filter((a) => a.type.startsWith("image/"));
  const nonImages = attachments.filter((a) => !a.type.startsWith("image/"));

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

  /** Validate the poll draft (when present) and return the value to send, or null to abort. */
  function resolvePoll(): { poll: { question: string; options: string[] } | null } | null {
    if (!pollDraft) return { poll: null };
    if (isPollDraftEmpty(pollDraft)) return { poll: null };
    const invalid = validatePollDraft(pollDraft);
    if (invalid) {
      setActiveTool("poll");
      setError(invalid);
      return null;
    }
    return { poll: serializePollDraft(pollDraft) };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write something before saving.");
      return;
    }
    const resolvedPoll = resolvePoll();
    if (!resolvedPoll) return;

    const title = bodyToTitle(body);
    // Like the Create modal, links are derived from the body text on save.
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
          tags,
          attachments,
          links: extractedLinks,
          allow_replies: allowReplies,
          is_public: isPublic,
          poll: resolvedPoll.poll,
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

  function openPoll() {
    setActiveTool("poll");
    setPollDraft((current) => current ?? { question: "", options: ["", ""] });
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-thread-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(820px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="edit-thread-title" className="font-display text-lg font-semibold text-foreground">
            Edit Thread
          </h2>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X strokeWidth={2.5} size={20} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* ── Composer body ── */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={THREAD_BODY_MAX_LENGTH}
              placeholder="What do you want to talk about?"
              rows={4}
              className="w-full resize-none overflow-hidden rounded-xl border border-border bg-surface-raised px-4 pb-6 pr-16 pt-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
            <span className="pointer-events-none absolute bottom-2 right-3 font-body text-[11px] tabular-nums text-foreground-subtle">
              {body.length}/{THREAD_BODY_MAX_LENGTH}
            </span>
          </div>

          {/* ── Media toolbar (below the text) ── */}
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,application/zip,text/plain"
              className="hidden"
              onChange={handleFiles}
            />
            <ComposerToolButton
              active={activeTool === "photo"}
              disabled={uploading}
              onClick={() => {
                if (activeTool !== "photo") { setActiveTool("photo"); return; }
                if (!uploading && images.length < THREAD_IMAGE_MAX) fileInputRef.current?.click();
              }}
            >
              {uploading && activeTool === "photo" ? <Spinner size={14} /> : <ImageIcon size={14} />}
              {uploading && activeTool === "photo" ? "Uploading…" : "Photo"}
            </ComposerToolButton>
            <ComposerToolButton active={activeTool === "poll"} onClick={openPoll}>
              <BarChart3 size={14} />
              Poll
            </ComposerToolButton>
          </div>

          {/* ── Active media panel ── */}
          {activeTool === "photo" && (
            <>
              <ImageAttachmentsRow
                images={images}
                uploading={uploading}
                onRemove={(url) => setAttachments((c) => c.filter((a) => a.url !== url))}
                onAddMore={() => fileInputRef.current?.click()}
              />
              <FileAttachmentList
                files={nonImages}
                onRemove={(url) => setAttachments((c) => c.filter((a) => a.url !== url))}
              />
            </>
          )}

          {activeTool === "poll" && pollDraft && (
            <div className="space-y-2">
              <PollComposer value={pollDraft} onChange={setPollDraft} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { setPollDraft(null); setActiveTool("photo"); setError(null); }}
                  className="font-body text-[11px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
                >
                  Remove poll
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-border" />

          {/* ── Category ── */}
          <CategoryPicker value={category} onChange={setCategory} />

          {/* ── Tags ── */}
          <TagPicker selected={tags} onChange={setTags} />

          {/* ── Toggles ── */}
          <div className="overflow-hidden rounded-xl border border-border bg-surface-raised divide-y divide-border">
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
          <div className="mx-6 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="font-body text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Spinner size={15} className="text-white" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
    </ModalPortal>
  );
}
