"use client";

import { useEffect, useRef, useState } from "react";
import { PenLine, Pencil, Save, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const INK = "#1D4ED8";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Decorative pagination dots (middle one filled) — mirrors the notebook footer. */
function PageDots() {
  return (
    <div className="flex items-center justify-center gap-1.5 pb-3 pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i === 2 ? "bg-[#1D4ED8]" : "bg-[#1D4ED8]/30"
          }`}
        />
      ))}
    </div>
  );
}

export default function DiaryPage() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/diary")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d) setEntries(d.entries ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (!content.trim() || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        editingId ? `/api/diary/${editingId}` : "/api/diary",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to save. Try again.");
        return;
      }
      if (editingId) {
        setEntries((prev) =>
          prev.map((e) => (e.id === editingId ? data.entry : e))
        );
      } else {
        setEntries((prev) => [data.entry, ...prev]);
      }
      setTitle("");
      setContent("");
      setEditingId(null);
    } catch {
      setErrorMsg("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(entry: DiaryEntry) {
    setEditingId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
    setErrorMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => editorRef.current?.focus(), 350);
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      const res = await fetch(`/api/diary/${deletingId}`, { method: "DELETE" });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== deletingId));
        if (editingId === deletingId) {
          setEditingId(null);
          setTitle("");
          setContent("");
        }
      }
    } catch {
      // keep entry; user can retry
    }
    setDeletingId(null);
  }

  const totalPages = entries.length + 1; // the editor page + saved pages

  return (
    <div className="flex min-h-full justify-center bg-background px-4 py-8 sm:px-8">
      <div className="w-full max-w-2xl">
        {/* ── Editor page (always on top) ─────────────────────────────────── */}
        <article className="diary-paper pt-[34px] pb-[30px] pl-[88px] pr-10 sm:pl-[96px]">
          {/* Header row */}
          <div className="flex h-[34px] items-center justify-between font-hand text-[20px] leading-[34px] text-[#1D4ED8]">
            <span className="flex items-center gap-1.5 font-semibold">
              <PenLine size={18} className="-rotate-12" />
              My Diary
            </span>
            <span className="text-[17px] text-[#1D4ED8]/70">
              {new Date().toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              · Page {totalPages} / {totalPages}
            </span>
          </div>

          {/* Title (yellow highlight) */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Title of this page…"
            className="diary-highlight mt-[34px] block h-[34px] w-full bg-transparent font-hand text-[26px] font-semibold leading-[34px] text-[#1D4ED8] outline-none placeholder:text-[#1D4ED8]/45"
          />

          {/* Writing area */}
          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={20000}
            rows={9}
            placeholder="Write something…"
            className="mt-[34px] block w-full resize-y border-0 bg-transparent p-0 font-hand text-[22px] leading-[34px] text-[#1D4ED8] outline-none placeholder:text-[#1D4ED8]/40"
          />

          {/* Footer: save */}
          <div className="mt-[34px] flex items-center justify-between">
            <span className="font-hand text-[17px] text-[#1D4ED8]/60">
              {editingId ? "Editing page…" : "New page"}
            </span>
            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setTitle("");
                    setContent("");
                    setErrorMsg(null);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!content.trim() || saving}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? (
                  <Spinner size={13} className="text-white" />
                ) : (
                  <Save size={13} />
                )}
                {editingId ? "Save changes" : "Save"}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="mt-2 text-right font-body text-xs text-red-500">
              {errorMsg}
            </p>
          )}

          <PageDots />
        </article>

        {/* ── Saved pages ────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5" />
          </div>
        ) : entries.length > 0 ? (
          <>
            <h2 className="mt-10 mb-4 flex items-center gap-1.5 font-hand text-[22px] font-semibold text-[#1D4ED8]/80">
              <Pencil size={16} className="-rotate-12" />
              Earlier pages
            </h2>
            <div className="space-y-8">
              {entries.map((entry, i) => (
                <article
                  key={entry.id}
                  className="diary-paper pt-[34px] pb-[30px] pl-[88px] pr-10 sm:pl-[96px]"
                >
                  {/* Header row */}
                  <div className="flex h-[34px] items-center justify-between font-hand text-[19px] leading-[34px] text-[#1D4ED8]">
                    <span className="font-semibold">{formatDate(entry.created_at)}</span>
                    <span className="text-[16px] text-[#1D4ED8]/70">
                      Page {entries.length - i} / {totalPages}
                    </span>
                  </div>

                  {entry.title && (
                    <h3 className="diary-highlight mt-[34px] w-fit max-w-full font-hand text-[24px] font-semibold leading-[34px] text-[#1D4ED8]">
                      {entry.title}
                    </h3>
                  )}

                  <div className="mt-[34px] whitespace-pre-wrap font-hand text-[22px] leading-[34px] text-[#1D4ED8]">
                    {entry.content}
                  </div>

                  {/* Actions */}
                  <div className="mt-[34px] flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(entry)}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(entry.id)}
                      className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 font-body text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>

                  <PageDots />
                </article>
              ))}
            </div>
          </>
        ) : null}

        <ConfirmDialog
          open={deletingId !== null}
          onClose={() => setDeletingId(null)}
          onConfirm={() => handleDelete()}
          title="Delete this page?"
          message="This diary page will be permanently deleted. This can't be undone."
          confirmLabel="Delete"
        />
      </div>
    </div>
  );
}
