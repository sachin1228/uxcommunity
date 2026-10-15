"use client";

import { useState } from "react";
import { PendingButton } from "@/components/ui/PendingButton";
import { Modal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";

const COPY = {
  linkedin: {
    title: "Add your LinkedIn",
    description: "Paste your LinkedIn profile link — it shows as a button on your profile.",
    label: "LinkedIn profile link",
    placeholder: "https://linkedin.com/in/yourname",
    field: "linkedin_url",
  },
  portfolio: {
    title: "Add your portfolio",
    description: "Paste your portfolio link — it shows as a button on your profile.",
    label: "Portfolio link",
    placeholder: "https://yourportfolio.com",
    field: "portfolio_url",
  },
} as const;

interface AddLinkModalProps {
  /** Which profile link is being saved — LinkedIn or portfolio. */
  kind: keyof typeof COPY;
  /** The current stored link, so the prompt opens on what exists. */
  initialUrl?: string;
  /** Fired with the trimmed link once the save landed. */
  onSaved: (url: string) => void;
  onClose: () => void;
}

/**
 * The profile hero's prompt for an outside link — LinkedIn or portfolio:
 * paste the URL, save, and the hollow circle under the city turns live.
 * Mounted only while open, so every visit starts from the stored value.
 * Settings keeps its own fields for both (the LinkedIn and Job profile cards).
 */
export function AddLinkModal({ kind, initialUrl = "", onSaved, onClose }: AddLinkModalProps) {
  const copy = COPY[kind];
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
        body: JSON.stringify({ [copy.field]: trimmed }),
      });
      if (!res.ok) {
        setError("Couldn't save this link. Please try again.");
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
    <Modal open onClose={onClose} maxWidth="max-w-md" title={copy.title}>
      <p className="mb-4 font-body text-sm text-foreground-muted">{copy.description}</p>

      {error && <ModalError className="mb-4">{error}</ModalError>}

      <label
        htmlFor="profile-link-modal-url"
        className="mb-1.5 block font-body text-xs font-medium text-foreground"
      >
        {copy.label}
      </label>
      <input
        id="profile-link-modal-url"
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={copy.placeholder}
        autoFocus
        className="field"
      />

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Cancel
        </button>
        <PendingButton
          type="button"
          onClick={handleSave}
          disabled={trimmed.length === 0}
          pending={saving}
          pendingLabel="Saving…"
          spinnerSize={14}
          className="modal-btn modal-btn-primary"
        >
          Save link
        </PendingButton>
      </div>
    </Modal>
  );
}
