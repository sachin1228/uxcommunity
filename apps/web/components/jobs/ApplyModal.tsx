"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Upload, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarImg } from "@/components/ui/AvatarImg";
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
 * an optional resume attachment. The name and links prefill from the
 * member's profile but stay editable: the application is what the poster
 * reads, not the profile. Eligibility is not checked here; the database
 * re-checks the applicant's profile row when the form is submitted.
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

  function pickResume(file: File | null) {
    if (!file) return;
    if (file.size > MAX_RESUME_BYTES) {
      setError("Resume exceeds the 5 MB limit.");
      return;
    }
    setResume(file);
    setError(null);
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

    setSubmitting(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("portfolio_url", portfolioUrl.trim());
      form.set("linkedin_url", linkedinUrl.trim());
      if (resume) form.set("resume", resume);

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
            <AvatarImg
              url={viewer.avatarUrl}
              name={viewer.name}
              size={40}
              className="rounded-full object-cover"
            />
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
              Resume <span className="text-foreground-subtle">(optional — PDF, DOC, DOCX, RTF)</span>
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.rtf"
              className="hidden"
              onChange={(event) => pickResume(event.target.files?.[0] ?? null)}
            />
            {resume ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
                <FileText strokeWidth={2.5} size={15} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">
                  {resume.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setResume(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="modal-btn modal-btn-secondary shrink-0 !h-7 text-[12px]"
                >
                  <X strokeWidth={2.5} size={12} />
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3.5 font-body text-sm text-foreground-muted transition-colors hover:border-accent hover:text-foreground"
              >
                <Upload strokeWidth={2.5} size={15} />
                Attach a resume
              </button>
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
