"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, RotateCcw, Square, Trash2 } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { EditJobModal } from "./EditJobModal";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { showUndoToast } from "@/lib/undo-toast";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost, JobStatus } from "@/lib/jobs/types";

/**
 * The posting owner's controls: Edit, Close/Reopen, Delete.
 *
 * They are asymmetric on purpose, because their consequences are. Edit is the
 * everyday action and sits in the open on the posting's own page. Close is
 * reversible — it keeps the URL, the applicants and the history while it stops
 * new applications — so it is confirmed by a plain menu pick and offered back
 * as an undo. Delete is the only irreversible one, so it is the only one behind
 * a dialog that names what disappears.
 *
 * Two surfaces render this: the posting's own page (`variant="full"`, an
 * inline Edit button plus the menu) and each row of the owner's list
 * (`variant="compact"`, the menu alone — a scanned list wants one small target,
 * not two). `master` is only needed to open the edit form, so a surface without
 * it still gets Close/Reopen/Delete.
 *
 * A posting whose closing date has passed is offered "Change deadline" in place
 * of "Edit job": the date is the lever that brings it back, and reopening it is
 * the same form.
 *
 * Everything here is a convenience over the database's own rule:
 * `update_job_post`, `set_job_post_status` and `delete_job_post` each re-check
 * that the posting is the session member's, so hiding these controls from
 * everyone else is presentation, never the gate.
 */
export function JobOwnerActions({
  job,
  master,
  variant = "full",
  /** False when deleting should leave the member where they are (the list). */
  redirectOnDelete = true,
}: {
  job: JobPost;
  master?: JobMasterData;
  variant?: "full" | "compact";
  redirectOnDelete?: boolean;
}) {
  const router = useRouter();
  const guard = useGuardedRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = job.status === "closed";

  /** Throws with the route's own message, so the undo offer can stay up. */
  async function setStatus(status: JobStatus): Promise<void> {
    const response = await fetch(`/api/jobs/${job.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "The job could not be updated.");
    }

    router.refresh();
  }

  /**
   * Close, then offer the way back. The undo runs the opposite write, so a
   * member who closed the wrong posting is one click from where they were.
   */
  async function closeJob() {
    setError(null);
    setPending(true);
    try {
      await setStatus("closed");
      showUndoToast({
        message: `“${job.title}” is closed — it no longer takes applications.`,
        actionLabel: "Reopen",
        onAction: () => setStatus("open"),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The job could not be closed.");
    } finally {
      setPending(false);
    }
  }

  async function reopenJob() {
    setError(null);
    setPending(true);
    try {
      await setStatus("open");
      showUndoToast({
        message: `“${job.title}” is open again — matching members can apply.`,
        actionLabel: "Undo",
        onAction: () => setStatus("closed"),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The job could not be reopened.");
    } finally {
      setPending(false);
    }
  }

  /**
   * Deliberately not thrown: ConfirmDialog resolves its confirm and closes, so
   * a refusal lands beside the trigger rather than leaving the dialog up as if
   * the member had not answered.
   */
  async function deleteJob() {
    setError(null);

    const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "The job could not be deleted.");
      return;
    }

    // Refresh the board either way: the deleted row must not be served from a
    // cached render, whether the member stays on the list or lands back on it.
    if (redirectOnDelete) guard.push("/dashboard/jobs");
    router.refresh();
  }

  /**
   * The whole control cluster is a click target of its own inside a job card,
   * which is itself a button — so pointer AND key events stop here. React
   * portals (the menu, the dialogs) bubble through the React tree rather than
   * the DOM, so without this a menu pick would also select the card, and Enter
   * on a focused menu item would navigate to the posting.
   */
  function contain(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  return (
    <div className="flex items-center gap-2" onClick={contain} onKeyDown={contain}>
      {variant === "full" && (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          disabled={!master || pending}
          className="modal-btn modal-btn-secondary !h-8 text-[12px]"
        >
          <Pencil strokeWidth={2.5} size={13} />
          Edit
        </button>
      )}

      <button
        type="button"
        ref={triggerRef}
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Job options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={pending}
        className={`flex shrink-0 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground ${
          variant === "full"
            ? "h-8 w-8 rounded-lg border border-border"
            : "h-7 w-7 rounded-md border border-transparent"
        }`}
      >
        {pending ? <Spinner size={14} /> : <MoreHorizontal strokeWidth={2.5} size={16} />}
      </button>

      {error && (
        <span role="status" className="font-body text-xs text-red-400">
          {error}
        </span>
      )}

      <DropdownMenu
        triggerRef={triggerRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        align="right"
        className="min-w-44 p-1"
      >
        {master && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setEditOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-foreground transition-colors hover:bg-white/[0.08]"
          >
            <Pencil strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
            {/* An expired posting comes back by moving its date, so the one item
                that fixes it says so. */}
            <span>{job.deadline_expired ? "Change deadline" : "Edit job"}</span>
          </button>
        )}

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            void (closed ? reopenJob() : closeJob());
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-foreground transition-colors hover:bg-white/[0.08]"
        >
          {closed ? (
            <RotateCcw strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
          ) : (
            <Square strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
          )}
          <span>{closed ? "Reopen job" : "Close job"}</span>
        </button>

        <div className="my-1 h-px bg-white/[0.08]" role="separator" />

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            setConfirmDelete(true);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-red-400 transition-colors hover:bg-red-400/10"
        >
          <Trash2 strokeWidth={2.5} size={14} className="shrink-0" />
          <span>Delete job</span>
        </button>
      </DropdownMenu>

      {editOpen && master && (
        <EditJobModal
          key={job.id}
          open
          job={job}
          master={master}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this job?"
        confirmLabel="Delete job"
        message={
          job.applicant_count > 0
            ? `This permanently deletes “${job.title}” and its ${job.applicant_count} application${
                job.applicant_count === 1 ? "" : "s"
              }. This can’t be undone — close the job instead if the role is simply filled.`
            : `This permanently deletes “${job.title}”. This can’t be undone.`
        }
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteJob}
      />
    </div>
  );
}
