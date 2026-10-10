"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import {
  MAX_SAVED_RESUMES,
  RESUME_MAX_BYTES,
  resumeMeta,
  type SavedResume,
} from "@/lib/settings/resumes";
import { SaveStatus, type SaveState } from "./SaveStatus";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".rtf"];

interface JobProfileSectionProps {
  initialPortfolioUrl: string;
  initialResumes: SavedResume[];
}

interface ResumesResponse {
  resumes?: SavedResume[];
  message?: string;
}

/**
 * Job profile — what a job application prefills: the portfolio link (a
 * debounced PATCH to /api/profile, the same autosave the old Contact & links
 * card used) and the saved resumes (max three, managed through
 * /api/settings/resumes; the default one is preselected in ApplyModal).
 *
 * Every resume mutation replaces the list from the response's `{ resumes }`,
 * so the UI never re-derives state the server already decided — and the
 * delete goes through ConfirmDialog because it is the one destructive action
 * on this page.
 */
export function JobProfileSection({ initialPortfolioUrl, initialResumes }: JobProfileSectionProps) {
  const [portfolio, setPortfolio] = useState(initialPortfolioUrl);
  const [portfolioState, setPortfolioState] = useState<SaveState>("idle");

  const [resumes, setResumes] = useState<SavedResume[]>(initialResumes);
  const [uploading, setUploading] = useState(false);
  const [defaultPendingId, setDefaultPendingId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedResume | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (portfolio === initialPortfolioUrl) return;
    const t = setTimeout(async () => {
      setPortfolioState("saving");
      try {
        // Trimmed string: the profile route stores "" as null, which is how a
        // cleared portfolio link is written (null never passes its type check).
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolio_url: portfolio.trim() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setPortfolioState("saved");
      } catch {
        setPortfolioState("error");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [portfolio, initialPortfolioUrl]);

  async function uploadResume(file: File) {
    setUploading(true);
    setResumeError(null);
    try {
      const form = new FormData();
      form.set("resume", file);
      const res = await fetch("/api/settings/resumes", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as ResumesResponse | null;
      if (!res.ok || !body?.resumes) {
        setResumeError(body?.message ?? "The resume could not be saved. Please try again.");
        return;
      }
      setResumes(body.resumes);
    } catch {
      setResumeError("The resume could not be saved. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function pickResume(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;

    // Client-side first: the same two checks the API re-validates on the
    // real bytes (size cap, extension allow-list), so the common mistakes
    // never leave the browser.
    if (file.size > RESUME_MAX_BYTES) {
      setResumeError("Resume exceeds the 5 MB limit.");
      return;
    }
    if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setResumeError("Attach a PDF, DOC, DOCX or RTF resume.");
      return;
    }
    void uploadResume(file);
  }

  async function makeDefault(id: string) {
    if (defaultPendingId !== null) return;
    setDefaultPendingId(id);
    setResumeError(null);
    try {
      const res = await fetch("/api/settings/resumes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => null)) as ResumesResponse | null;
      if (!res.ok || !body?.resumes) {
        setResumeError(body?.message ?? "That change could not be saved. Please try again.");
        return;
      }
      setResumes(body.resumes);
    } catch {
      setResumeError("That change could not be saved. Check your connection and try again.");
    } finally {
      setDefaultPendingId(null);
    }
  }

  async function deleteResume() {
    if (!deleteTarget) return;
    // Deliberately not thrown: ConfirmDialog resolves its confirm and closes,
    // and a failed delete reports here, next to the rest of the resume state.
    try {
      const res = await fetch(`/api/settings/resumes?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => null)) as ResumesResponse | null;
      if (!res.ok || !body?.resumes) {
        setResumeError(body?.message ?? "The resume could not be deleted. Please try again.");
        return;
      }
      setResumes(body.resumes);
    } catch {
      setResumeError("The resume could not be deleted. Check your connection and try again.");
    }
  }

  const count = resumes.length;
  const canUpload = count < MAX_SAVED_RESUMES;
  const rowBusy = uploading || defaultPendingId !== null;

  return (
    <section aria-labelledby="settings-job-profile-heading" className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="settings-job-profile-heading" className="font-display text-[15px] font-semibold text-foreground">
            Job profile
          </h2>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            What we prefill when you apply to a role.
          </p>
        </div>
        <SaveStatus state={portfolioState} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="settings-portfolio" className="font-body text-xs font-medium text-foreground">
          Portfolio link
        </label>
        <input
          id="settings-portfolio"
          type="url"
          value={portfolio}
          onChange={(event) => setPortfolio(event.target.value)}
          placeholder="https://yourportfolio.com"
          className="field"
        />
        <p className="font-body text-xs text-foreground-muted">
          Fills the portfolio field when you apply to a job.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="font-body text-xs font-medium text-foreground">
          Resumes{" "}
          <span className="font-normal text-foreground-muted">
            · {count} of {MAX_SAVED_RESUMES}
          </span>
        </p>

        {count === 0 ? (
          <p className="font-body text-xs text-foreground-muted">
            No resumes yet. Save up to 3 and pick one when you apply.
          </p>
        ) : (
          <div className="mt-0.5 flex flex-col gap-2">
            {resumes.map((resume) => (
              <div
                key={resume.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
              >
                <FileText strokeWidth={2.5} size={15} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm text-foreground" title={resume.fileName}>
                    {resume.fileName}
                  </p>
                  <p className="font-body text-xs text-foreground-muted">{resumeMeta(resume)}</p>
                </div>
                {resume.isDefault && (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-body text-[11px] text-foreground-muted">
                    Default
                  </span>
                )}
                {!resume.isDefault && (
                  <button
                    type="button"
                    onClick={() => void makeDefault(resume.id)}
                    disabled={rowBusy}
                    className="modal-btn modal-btn-secondary shrink-0 !h-7 text-[12px]"
                  >
                    {defaultPendingId === resume.id && <Spinner size={12} />}
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(resume)}
                  disabled={rowBusy}
                  aria-label="Delete resume"
                  className="modal-btn modal-btn-danger-soft shrink-0 !h-7 !w-7 !px-0"
                >
                  <Trash2 strokeWidth={2.5} size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {count > 0 && (
          <p className="font-body text-xs text-foreground-muted">
            Your default resume is preselected when you apply.
          </p>
        )}

        {resumeError && (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400"
            role="alert"
          >
            {resumeError}
          </p>
        )}

        {canUpload ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.rtf"
              className="hidden"
              onChange={pickResume}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3.5 font-body text-sm text-foreground-muted transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? <Spinner size={15} /> : <Upload strokeWidth={2.5} size={15} />}
              {uploading ? "Uploading…" : "Add a resume"}
            </button>
            <p className="font-body text-xs text-foreground-muted">
              PDF, DOC, DOCX or RTF — up to 5 MB.
            </p>
          </div>
        ) : (
          <p className="mt-1 font-body text-xs text-foreground-muted">
            {MAX_SAVED_RESUMES} of {MAX_SAVED_RESUMES} resumes saved. Delete one to add another.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteResume}
        title="Delete resume"
        message={
          deleteTarget ? (
            <>
              Delete <span className="text-foreground">{deleteTarget.fileName}</span>? Applications
              already sent keep their copy.
            </>
          ) : (
            ""
          )
        }
      />
    </section>
  );
}
