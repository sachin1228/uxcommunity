"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import type { JobMasterData } from "@/lib/jobs/service";
import type { EmploymentType, JobKind, JobViewer, WorkMode } from "@/lib/jobs/types";
import { EMPLOYMENT_TYPES, WORK_MODES } from "@/lib/jobs/types";

const labelCls = "font-body text-xs font-medium text-foreground";

interface PostJobModalProps {
  open: boolean;
  onClose: () => void;
  viewer: JobViewer;
  master: JobMasterData;
  onCreated: (jobId: string) => void;
}

/**
 * Post a job, in one modal.
 *
 * Both post types need the same proof — a company verified with a work email
 * (the membership row the profile badge reads). "Hiring" lets the poster
 * verify a company right here via the shared AddCompanyModal; "Referral"
 * posts under the company already verified on their profile. The form never
 * decides trust: the database's create_job_post re-checks the membership and
 * the master data before a row lands.
 */
export function PostJobModal({ open, onClose, viewer, master, onCreated }: PostJobModalProps) {
  const router = useRouter();

  const [kind, setKind] = useState<JobKind>("hiring");
  const [showCompanyModal, setShowCompanyModal] = useState(false);

  const [title, setTitle] = useState("");
  const [cityId, setCityId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("hybrid");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [salary, setSalary] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The company verified on the profile is the one a posting can use; a
  // verification done in-flow lands in viewer.company after router.refresh().
  const company = viewer.company;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (!company) {
      setError("Verify your company with a work email before posting.");
      return;
    }
    if (title.trim().length < 2) {
      setError("Add a role title.");
      return;
    }
    if (!cityId || !sectorId || !jobTitle || !experienceLevel) {
      setError("Choose the city, sector, job title and experience level — they decide who can apply.");
      return;
    }
    if (!description.trim()) {
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
          title: title.trim(),
          city_id: cityId,
          sector_id: sectorId,
          job_title: jobTitle,
          experience_level: experienceLevel,
          work_mode: workMode,
          employment_type: employmentType,
          salary: salary.trim(),
          description: description.trim(),
          website: website.trim(),
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

      onCreated(body.job_id);
    } catch {
      setError("The job could not be posted. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Post a job" maxWidth="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
              {error}
            </p>
          )}

          {/* Post type */}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>Post type</span>
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
            <span className={labelCls}>Company</span>
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

          {/* Role */}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>
              Role title <span className="text-red-400">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Senior Product Designer — Payments"
              maxLength={140}
              className="field"
            />
          </div>

          {/* Criteria — the four dimensions that gate applying */}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>
              Who can apply <span className="text-red-400">*</span>
            </span>
            <p className="-mt-1 font-body text-[11px] text-foreground-subtle">
              Only members whose profile matches all four dimensions can apply.
            </p>
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SearchableSelect
                options={master.cities.map((c) => ({ value: c.id, label: c.name, imageUrl: c.imageUrl }))}
                value={cityId}
                onChange={setCityId}
                placeholder="City"
              />
              <SearchableSelect
                options={master.sectors.map((s) => ({ value: s.id, label: s.name, imageUrl: s.imageUrl }))}
                value={sectorId}
                onChange={setSectorId}
                placeholder="Industry sector"
              />
              <SearchableSelect
                options={master.jobTitles.map((j) => ({ value: j.slug, label: j.label, imageUrl: j.imageUrl }))}
                value={jobTitle}
                onChange={setJobTitle}
                placeholder="Job title"
              />
              <SearchableSelect
                options={master.experienceLevels.map((l) => ({ value: l.slug, label: l.label, imageUrl: l.imageUrl }))}
                value={experienceLevel}
                onChange={setExperienceLevel}
                placeholder="Experience level"
              />
            </div>
          </div>

          {/* Arrangement */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Work mode</span>
              <select
                value={workMode}
                onChange={(event) => setWorkMode(event.target.value as WorkMode)}
                className="field"
              >
                {WORK_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Employment type</span>
              <select
                value={employmentType}
                onChange={(event) => setEmploymentType(event.target.value as EmploymentType)}
                className="field"
              >
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>
              Salary <span className="text-foreground-subtle">(optional)</span>
            </span>
            <input
              type="text"
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
              placeholder="e.g. ₹18–24L / year — leave empty for “Not disclosed”"
              maxLength={80}
              className="field"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>
              About the role <span className="text-red-400">*</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="What the team does, why this role exists, how you work…"
              className="field resize-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>
              Website <span className="text-foreground-subtle">(optional)</span>
            </span>
            <input
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://…"
              className="field"
            />
          </label>

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
              {submitting ? <Spinner className="h-3.5 w-3.5 text-white" /> : <Plus strokeWidth={2.5} size={14} />}
              {submitting ? "Posting…" : "Publish job"}
            </button>
          </div>
        </form>
      </Modal>

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
