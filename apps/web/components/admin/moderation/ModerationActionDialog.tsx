"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";
import { PendingButton } from "@/components/ui/PendingButton";
import {
  DESTRUCTIVE_MODERATION_ACTIONS,
  MAX_SUSPENSION_DAYS,
  MODERATION_ACTION_LABELS,
  SUSPENSION_DAY_OPTIONS,
  type ModerationActionId,
} from "@/lib/moderation/action-catalog";

const ACTION_EXPLANATIONS: Record<ModerationActionId, string> = {
  dismiss:
    "Closes the report without any action. The target and the account are untouched.",
  remove:
    "Permanently deletes the reported comment or chat message. The evidence snapshot on the report is kept.",
  hide_community:
    "Hides the community from every member. Its members, owner, messages and content are kept.",
  deactivate_job:
    "Closes the listing so it leaves the job board and stops taking applications. Applications and applicant data are kept.",
  warn_user:
    "Sends the account a warning explaining what was wrong. The content stays up.",
  suspend_user:
    "Signs the account out and blocks sign-in until the suspension ends. The account becomes usable again automatically.",
  ban_user:
    "Blocks the account permanently and revokes every session. The member can only return through a granted appeal.",
};

const NOTE_LABELS: Partial<Record<ModerationActionId, string>> = {
  remove: "Reason shown to the member",
  hide_community: "Reason shown to the owner",
  deactivate_job: "Reason shown to the poster",
  warn_user: "What the warning says",
  suspend_user: "Reason for the suspension",
  ban_user: "Reason for the ban",
  dismiss: "Internal note (optional)",
};

/**
 * One confirmation surface for every moderator action.
 *
 * Destructive actions always confirm and say exactly what survives — a job's
 * applications, a community's members and content, the report's evidence — so
 * a reviewer cannot take a wider action than they intended. The optional note
 * is quoted to the affected member, never the reporter's identity.
 */
export function ModerationActionDialog({
  open,
  action,
  targetLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  action: ModerationActionId | null;
  targetLabel: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: { note: string; suspendDays: number | null }) => void;
}) {
  // The caller keys this component by target + action, so every new decision
  // starts with an empty note — the previous explanation can never be attached
  // to the next one.
  const [note, setNote] = useState("");
  const [suspendDays, setSuspendDays] = useState<number>(7);

  if (!action) return null;

  const destructive = DESTRUCTIVE_MODERATION_ACTIONS.has(action);
  const confirmLabel = MODERATION_ACTION_LABELS[action];

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidth="max-w-md"
    >
      <div className="mb-4 flex items-start gap-3">
        {destructive && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertTriangle size={16} strokeWidth={2.5} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {confirmLabel}
          </h2>
          <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
            {ACTION_EXPLANATIONS[action]} Target: <span className="text-foreground">{targetLabel}</span>.
          </p>
        </div>
      </div>

      {action === "suspend_user" && (
        <div className="mb-4">
          <label htmlFor="suspend-days" className="font-body text-[11px] font-medium text-foreground">
            Suspension length
          </label>
          <select
            id="suspend-days"
            value={suspendDays}
            onChange={(event) => setSuspendDays(Number(event.target.value))}
            className="field mt-1.5 h-9 w-full text-xs"
            disabled={busy}
          >
            {SUSPENSION_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} day{days === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <p className="mt-1 font-body text-[10px] text-foreground-subtle">
            Maximum {MAX_SUSPENSION_DAYS} days. A permanent block is the Ban action.
          </p>
        </div>
      )}

      <label htmlFor="moderation-note" className="font-body text-[11px] font-medium text-foreground">
        {NOTE_LABELS[action] ?? "Note"}
      </label>
      <textarea
        id="moderation-note"
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 500))}
        rows={3}
        maxLength={500}
        disabled={busy}
        placeholder="Optional — this is stored in the audit log and quoted to the member."
        className="field mt-1.5 w-full resize-none leading-5"
      />
      <div className="mt-1 flex justify-end font-mono text-[10px] text-foreground-subtle">
        {note.length}/500
      </div>

      {error && <ModalError className="mt-3">{error}</ModalError>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="modal-btn modal-btn-secondary"
        >
          Cancel
        </button>
        <PendingButton
          type="button"
          pending={busy}
          pendingLabel="Applying…"
          spinnerSize={13}
          onClick={() => onConfirm({ note: note.trim(), suspendDays: action === "suspend_user" ? suspendDays : null })}
          className={destructive ? "modal-btn modal-btn-danger" : "modal-btn modal-btn-primary"}
        >
          {confirmLabel}
        </PendingButton>
      </div>
    </Modal>
  );
}
