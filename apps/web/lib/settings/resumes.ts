/**
 * Saved-resume policy shared by the settings API route and the Settings page
 * UI, so the limit and the labels can never disagree between the two.
 *
 * A saved resume is a row in `public.member_resumes` whose file lives in R2.
 * The member keeps up to MAX_SAVED_RESUMES of them and one row is the default
 * — it is preselected when they apply to a job (see ApplyModal).
 */

/** How many resumes a member may save. Enforced by the API, mirrored in the UI. */
export const MAX_SAVED_RESUMES = 3;

/**
 * The upload size cap (5 MB) every resume surface enforces.
 *
 * Lives here, not in `lib/jobs/resume-file.ts`, so the Settings UI can import
 * it into the browser: that module parses `Buffer`s at import time and must
 * stay server-only. `resume-file.ts` re-exports this value, so there is still
 * exactly one number.
 */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

/** One saved resume, exactly as `/api/settings/resumes` returns it. */
export interface SavedResume {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  isDefault: boolean;
  createdAt: string;
}

const RESUME_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/rtf": "RTF",
};

/** "PDF" / "DOC" / "DOCX" / "RTF" — the short label for a resume's mime type. */
export function resumeTypeLabel(mimeType: string): string {
  return RESUME_TYPE_LABELS[mimeType] ?? mimeType.split("/")[1]?.toUpperCase() ?? "FILE";
}

/** "240 KB" / "1.2 MB" — the human size shown in a resume's meta line. */
export function formatResumeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "10 Oct"-style short date, UTC like the rest of the app's stamps. */
export function formatResumeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "PDF · 240 KB · 10 Oct" — the meta line under a resume's name. */
export function resumeMeta(
  resume: Pick<SavedResume, "mimeType" | "sizeBytes" | "createdAt">,
): string {
  return `${resumeTypeLabel(resume.mimeType)} · ${formatResumeSize(resume.sizeBytes)} · ${formatResumeDate(resume.createdAt)}`;
}
