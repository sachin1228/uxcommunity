"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import {
  JobFormFields,
  jobFieldLabel,
  jobFormPayload,
  jobFormValuesFrom,
  type JobFormValues,
} from "./JobFormFields";
import { richTextIsEmpty } from "@/lib/jobs/rich-text";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost } from "@/lib/jobs/types";

interface EditJobModalProps {
  open: boolean;
  onClose: () => void;
  job: JobPost;
  master: JobMasterData;
  /** The stamp the save wrote — null when the edit changed nothing. */
  onSaved: (editedAt: string | null) => void;
}

/**
 * Edit a posting the member owns, prefilled from it.
 *
 * Mount this only while it is open (and key it by the posting) so the form
 * always opens on the stored values rather than a stale draft.
 *
 * The post type and the company are shown but not editable: they are the
 * verified proof the posting was made under, and changing either one is a new
 * posting, not an edit. The four targeting fields lock once anyone has
 * applied — the form disables them from the payload's own `criteria_locked`,
 * and `update_job_post` refuses the change regardless of what is sent.
 */
export function EditJobModal({ open, onClose, job, master, onSaved }: EditJobModalProps) {
  const [values, setValues] = useState<JobFormValues>(() => jobFormValuesFrom(job));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (next: Partial<JobFormValues>) => setValues((current) => ({ ...current, ...next }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (values.title.trim().length < 2) {
      setError("Add a role title.");
      return;
    }
    if (!values.cityId || !values.sectorId || !values.jobTitle || !values.experienceLevel) {
      setError("Choose the city, sector, job title and experience level — they decide who can apply.");
      return;
    }
    // A description of `<p><br></p>` is not empty by `trim` and says nothing,
    // so the field is asked the same question the database will ask.
    if (richTextIsEmpty(values.description)) {
      setError("Add a role description.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/jobs/${job.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobFormPayload(values)),
      });

      const body = (await response.json().catch(() => null)) as
        | { edited_at?: string | null; message?: string; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.message ?? "The changes could not be saved. Please try again.");
        setSubmitting(false);
        return;
      }

      onSaved(body?.edited_at ?? null);
    } catch {
      setError("The changes could not be saved. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} title="Edit job" maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
            {error}
          </p>
        )}

        {/* Fixed identity: what the posting is, and the proof it stands on. */}
        <div className="flex flex-col gap-1.5">
          <span className={jobFieldLabel}>Posted under</span>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
            <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-sm font-semibold text-foreground">
                {job.company.name}
              </p>
              <p className="mt-0.5 font-body text-[11px] text-foreground-muted">
                {job.kind === "hiring" ? "Hiring" : "Referral"} — the post type and company can’t
                change. Post a new role instead.
              </p>
            </div>
          </div>
        </div>

        <JobFormFields
          values={values}
          onChange={patch}
          master={master}
          criteriaLocked={job.criteria_locked}
        />

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="modal-btn modal-btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="modal-btn modal-btn-primary">
            {submitting ? <Spinner className="h-3.5 w-3.5 text-white" /> : <Save strokeWidth={2.5} size={14} />}
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
