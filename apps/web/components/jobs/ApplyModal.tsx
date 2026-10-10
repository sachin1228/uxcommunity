"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Upload, X } from "lucide-react";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { resumeMeta, type SavedResume } from "@/lib/settings/resumes";
import type { JobPost, JobViewer } from "@/lib/jobs/types";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

interface ApplyModalProps {
  open: boolean;
  onClose: () => void;
  job: JobPost;
  viewer: JobViewer;
  /** Called once the application lands, so the page behind can refresh. */
  onApplied: () => void;
}

/**
 * The application is exactly three fields — name, portfolio, LinkedIn — plus
 * a required resume. The name and links prefill from the member's profile
 * but stay editable: the application is what the poster reads, not the
 * profile. Eligibility is not checked here; the database re-checks the
 * applicant's profile row when the form is submitted.
 *
 * The resume comes from one of two sources. A member with saved resumes
 * (Settings → Job profile) picks one from a radio list — the default is
 * preselected — or chooses "Upload a new file" (the original attach row). A
 * member without saved resumes, or when the saved-resume list cannot be
 * loaded, sees the upload-only control; the first upload by a member with no
 * saved resumes is adopted into their job profile server-side, so the next
 * time the modal opens it is offered there. The modal must never break
 * applying, so a failed GET falls back silently.
 */
export function ApplyModal({ open, onClose, job, viewer, onApplied }: ApplyModalProps) {
  const [name, setName] = useState(viewer.name);
  const [portfolioUrl, setPortfolioUrl] = useState(viewer.portfolioUrl ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(viewer.linkedinUrl ?? "");
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Saved resumes + the chosen option ("saved:<id>" | "upload").
  // `savedResumes` stays null until a successful load with ≥1 row — null is
  // exactly the fallback signal the Resume block renders from. `resumesLoaded`
  // records a successful load even of an empty list, which is what gates the
  // first-upload hint below.
  const [savedResumes, setSavedResumes] = useState<SavedResume[] | null>(null);
  const [resumesLoaded, setResumesLoaded] = useState(false);
  const [resumeChoice, setResumeChoice] = useState("");
  const resumesRequestedRef = useRef(false);

  useEffect(() => {
    if (!open || resumesRequestedRef.current) return;
    resumesRequestedRef.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/settings/resumes");
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as { resumes?: SavedResume[] } | null;
        const list = body?.resumes;
        if (!Array.isArray(list)) return;
        setResumesLoaded(true);
        if (list.length === 0) return;
        setSavedResumes(list);
        const preset = list.find((entry) => entry.isDefault) ?? list[0];
        setResumeChoice(`saved:${preset.id}`);
      } catch {
        // Silent fallback to the upload-only control below.
      }
    })();
  }, [open]);

  function pickResume(file: File | null) {
    if (!file) return;
    if (file.size > MAX_RESUME_BYTES) {
      setError("Resume exceeds the 5 MB limit.");
      return;
    }
    setResume(file);
    setError(null);
  }

  function clearPickedResume() {
    setResume(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(portfolioUrl.trim())) {
      setError("Enter a portfolio link starting with http(s)://");
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(linkedinUrl.trim()) || !linkedinUrl.includes("linkedin.com")) {
      setError("Enter your LinkedIn profile link (linkedin.com/…)");
      return;
    }
    if (savedResumes) {
      // The list always preselects a saved resume, so the only incomplete
      // choice is the upload option with nothing attached yet.
      if (resumeChoice === "upload" && !resume) {
        setError("Attach a resume to apply.");
        return;
      }
    } else if (!resume) {
      // No usable saved list (empty or not loaded): the upload is the resume.
      setError("Attach a resume to apply.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("portfolio_url", portfolioUrl.trim());
      form.set("linkedin_url", linkedinUrl.trim());
      if (savedResumes) {
        // A saved resume travels as its id — the server copies the stored
        // URL onto the application; nothing is uploaded again.
        const chosen =
          savedResumes.find((entry) => `saved:${entry.id}` === resumeChoice) ?? null;
        if (chosen) form.set("saved_resume_id", chosen.id);
        else if (resume) form.set("resume", resume);
      } else if (resume) {
        form.set("resume", resume);
      }

      const response = await fetch(`/api/jobs/${job.id}/apply`, {
        method: "POST",
        body: form,
      });

      const body = (await response.json().catch(() => null)) as
        | { application_id?: string; message?: string; error?: string }
        | null;

      if (!response.ok || !body?.application_id) {
        setError(body?.message ?? "Your application could not be sent. Please try again.");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
      // The next open starts fresh: re-arm the fetch guard and drop the loaded
      // list, so the reload shows any resume the server just adopted (a first
      // upload with none saved) and the hint state stays truthful.
      resumesRequestedRef.current = false;
      setSavedResumes(null);
      setResumesLoaded(false);
      onApplied();
    } catch {
      setError("Your application could not be sent. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={submitted ? undefined : "Apply"}
      maxWidth="max-w-lg"
    >
      {submitted ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
            <CheckCircle2 strokeWidth={2.5} size={24} />
          </div>
          <h3 className="font-display text-lg font-semibold text-foreground">Application sent</h3>
          <p className="max-w-sm font-body text-sm leading-relaxed text-foreground-muted">
            Your application to <span className="text-foreground">{job.company.name}</span> is
            with {job.poster.name}.
          </p>
          <button type="button" onClick={onClose} className="modal-btn modal-btn-primary mt-1">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
            <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={40} />
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-semibold text-foreground">
                {job.title}
              </p>
              <p className="truncate font-body text-xs text-foreground-muted">
                {job.company.name}
                <span className="mx-1.5 text-foreground-subtle">·</span>
                {job.city_name}
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Full name <span className="text-red-400">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className="field"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Portfolio link <span className="text-red-400">*</span>
            </span>
            <input
              type="url"
              value={portfolioUrl}
              onChange={(event) => setPortfolioUrl(event.target.value)}
              placeholder="https://yourportfolio.com"
              className="field"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              LinkedIn <span className="text-red-400">*</span>
            </span>
            <input
              type="url"
              value={linkedinUrl}
              onChange={(event) => setLinkedinUrl(event.target.value)}
              placeholder="https://www.linkedin.com/in/…"
              className="field"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Resume <span className="text-red-400">*</span> <span className="text-foreground-subtle">(PDF, DOC, DOCX, RTF — up to 5 MB)</span>
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.rtf"
              className="hidden"
              onChange={(event) => pickResume(event.target.files?.[0] ?? null)}
            />
            {savedResumes ? (
              <div className="flex flex-col gap-1.5">
                {savedResumes.map((entry) => (
                  <ResumeOption
                    key={entry.id}
                    checked={resumeChoice === `saved:${entry.id}`}
                    onSelect={() => setResumeChoice(`saved:${entry.id}`)}
                    label={entry.fileName}
                    meta={resumeMeta(entry)}
                    badge={entry.isDefault ? "Default" : undefined}
                  />
                ))}
                <ResumeOption
                  checked={resumeChoice === "upload"}
                  onSelect={() => setResumeChoice("upload")}
                  label="Upload a new file"
                />
                {resumeChoice === "upload" &&
                  (resume ? (
                    <PickedResumeRow file={resume} onRemove={clearPickedResume} />
                  ) : (
                    <AttachResumeButton onClick={() => fileInputRef.current?.click()} />
                  ))}
              </div>
            ) : resume ? (
              <PickedResumeRow file={resume} onRemove={clearPickedResume} />
            ) : (
              <AttachResumeButton onClick={() => fileInputRef.current?.click()} />
            )}
            {resumesLoaded && !savedResumes && (
              <p className="font-body text-xs text-foreground-subtle">
                Saved to your job profile for next time.
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
              {error}
            </p>
          )}

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
              {submitting && <Spinner className="h-3.5 w-3.5 text-white" />}
              {submitting ? "Sending…" : "Send application"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** One choice in the resume radio group (a saved resume, or a one-off upload). */
function ResumeOption({
  checked,
  onSelect,
  label,
  meta,
  badge,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  meta?: string;
  badge?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        checked ? "border-accent bg-accent-soft" : "border-border hover:border-accent/40"
      }`}
    >
      <input
        type="radio"
        name="resume-choice"
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/25 ${
          checked ? "border-accent" : "border-foreground-subtle"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-sm text-foreground">{label}</span>
        {meta && <span className="block truncate font-body text-xs text-foreground-muted">{meta}</span>}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-body text-[11px] text-foreground-muted">
          {badge}
        </span>
      )}
    </label>
  );
}

/** The picked upload, with its remove action — same row as before the picker. */
function PickedResumeRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
      <FileText strokeWidth={2.5} size={15} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">
        {file.name}
      </span>
      <button type="button" onClick={onRemove} className="modal-btn modal-btn-secondary shrink-0 !h-7 text-[12px]">
        <X strokeWidth={2.5} size={12} />
        Remove
      </button>
    </div>
  );
}

/** The dashed attach control, identical whether the picker is shown or not. */
function AttachResumeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3.5 font-body text-sm text-foreground-muted transition-colors hover:border-accent hover:text-foreground"
    >
      <Upload strokeWidth={2.5} size={15} />
      Attach a resume
    </button>
  );
}
