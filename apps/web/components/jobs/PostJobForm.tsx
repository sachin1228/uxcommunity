"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import {
  EMPTY_JOB_FORM,
  JobCriteriaFields,
  JobIdentityFields,
  jobFieldLabel,
  JobTermFields,
  jobFormPayload,
} from "./JobFormFields";
import type { JobMasterData } from "@/lib/jobs/service";
import { richTextIsEmpty } from "@/lib/jobs/rich-text";
import type { JobKind, JobViewer } from "@/lib/jobs/types";
import type { JobFormValues } from "./JobFormFields";

/**
 * Posting a job, on its own page.
 *
 * The form outgrew its dialog: a rich description, two post types, the company
 * proof and seven role fields made a panel that scrolled inside a scroll. On a
 * page it gets the full height, the posting it creates is a URL that survives a
 * reload, and the member can move to another tab to fetch text without losing a
 * half-written role.
 *
 * Both post types need the same proof — a company verified with a work email
 * (the membership row the profile badge reads). "Hiring" lets the poster verify
 * a company in place via the shared AddCompanyModal; "Referral" posts under the
 * company already verified on their profile. The form never decides trust: the
 * database's create_job_post re-checks the membership and the master data
 * before a row lands.
 *
 * The role fields themselves come from JobFormFields, which the edit modal
 * renders too — the two forms stay identical by construction. The fields are
 * drawn here as three cards, one per kind of question: what the role is, who
 * may apply for it, and the terms it comes with. A long form is easier to
 * finish when it reads as three short ones.
 */
export function PostJobForm({ viewer, master }: { viewer: JobViewer; master: JobMasterData }) {
  const router = useRouter();

  const [kind, setKind] = useState<JobKind>("hiring");
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [values, setValues] = useState<JobFormValues>(EMPTY_JOB_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The company verified on the profile is the one a posting can use; a
  // verification done in-flow lands in viewer.company after router.refresh().
  const company = viewer.company;

  const patch = (next: Partial<JobFormValues>) => setValues((current) => ({ ...current, ...next }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (!company) {
      setError("Verify your company with a work email before posting.");
      return;
    }
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
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          company_id: company.id,
          ...jobFormPayload(values),
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { job_id?: string; message?: string; error?: string }
        | null;

      if (!response.ok || !body?.job_id) {
        setError(body?.message ?? "The job could not be posted. Please try again.");
        setSubmitting(false);
        return;
      }

      // The posting's own page is the receipt: it shows the role as members
      // will see it, with the owner's controls on it.
      router.push(`/dashboard/jobs/${body.job_id}`);
    } catch {
      setError("The job could not be posted. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
            {error}
          </p>
        )}

        {/* Card one — the role: what it is, and who is posting it. */}
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
          {/* Post type */}
          <div className="flex flex-col gap-1.5">
            <span className={jobFieldLabel}>Post type</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TypeCard
                active={kind === "hiring"}
                onClick={() => setKind("hiring")}
                title="Hiring"
                description="An opening at your company, posted by a verified member."
              />
              <TypeCard
                active={kind === "referral"}
                onClick={() => setKind("referral")}
                title="Referral"
                description="You're referring a role at the company on your profile."
              />
            </div>
          </div>

          {/* Company */}
          <div className="flex flex-col gap-1.5">
            <span className={jobFieldLabel}>Company</span>
            {company ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
                <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm font-semibold text-foreground">
                    {company.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 font-body text-[11px] text-foreground-muted">
                    <VerifiedMark label={false} size="xs" />
                    Verified with your work email
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(true)}
                  className="modal-btn modal-btn-secondary shrink-0 !h-7 text-[12px]"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCompanyModal(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 font-body text-sm text-foreground-muted transition-colors hover:border-accent hover:text-foreground"
              >
                <Building2 strokeWidth={2.5} size={15} />
                Verify your company with a work email to post
              </button>
            )}
          </div>

          <JobIdentityFields values={values} onChange={patch} master={master} />
        </section>

        {/* Card two — the four dimensions that decide who can apply. */}
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
          <JobCriteriaFields values={values} onChange={patch} master={master} />
        </section>

        {/* Card three — the terms the role comes with. */}
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
          <JobTermFields values={values} onChange={patch} />
        </section>

        <div className="flex justify-end gap-2 pt-4">
          {/* A link, not a button that resets state: leaving the page is a
              navigation, and it stays one for a middle-click or a back press. */}
          <Link href="/dashboard/jobs" className="modal-btn modal-btn-secondary">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="modal-btn modal-btn-primary">
            {submitting ? <Spinner className="h-3.5 w-3.5 text-white" /> : <Plus strokeWidth={2.5} size={14} />}
            {submitting ? "Posting…" : "Publish job"}
          </button>
        </div>
      </form>

      <AddCompanyModal
        open={showCompanyModal}
        onClose={() => setShowCompanyModal(false)}
        onVerified={() => {
          setShowCompanyModal(false);
          // The verified company is now on the profile — the refreshed viewer
          // prop makes it the selected company without losing this form.
          router.refresh();
        }}
      />
    </>
  );
}

function TypeCard({
  active,
  onClick,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-accent bg-accent-soft"
          : "border-border bg-surface hover:border-accent/40 hover:bg-surface-raised"
      }`}
    >
      <span className="font-body text-sm font-semibold text-foreground">{title}</span>
      <span className="font-body text-xs leading-snug text-foreground-muted">{description}</span>
    </button>
  );
}
