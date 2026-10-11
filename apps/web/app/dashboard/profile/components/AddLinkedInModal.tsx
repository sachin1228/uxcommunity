"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";

interface AddLinkedInModalProps {
  /** The current stored link, so the prompt opens on what exists. */
  initialUrl?: string;
  /** Fired with the trimmed link once the save landed. */
  onSaved: (url: string) => void;
  onClose: () => void;
}

/**
 * The profile hero's add-LinkedIn prompt: paste a profile link, save, and the
 * hollow circle under the city turns live. Mounted only while open, so every
 * visit starts from the stored value. Settings' LinkedIn card keeps its own
 * field for editing the link from there.
 */
export function AddLinkedInModal({ initialUrl = "", onSaved, onClose }: AddLinkedInModalProps) {
  const [url, setUrl] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = url.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: trimmed }),
      });
      if (!res.ok) {
        setError("Couldn't save your LinkedIn link. Please try again.");
        return;
      }
      onSaved(trimmed);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" title="Add your LinkedIn">
      <p className="mb-4 font-body text-sm text-foreground-muted">
        Paste your LinkedIn profile link — it shows as a button on your profile.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="font-body text-sm text-red-400">{error}</p>
        </div>
      )}

      <label
        htmlFor="linkedin-modal-url"
        className="mb-1.5 block font-body text-xs font-medium text-foreground"
      >
        LinkedIn profile link
      </label>
      <input
        id="linkedin-modal-url"
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://linkedin.com/in/yourname"
        autoFocus
        className="field"
      />

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || trimmed.length === 0}
          className="modal-btn modal-btn-primary"
        >
          {saving && <Spinner className="size-3.5" />}
          {saving ? "Saving…" : "Save link"}
        </button>
      </div>
    </Modal>
  );
}
