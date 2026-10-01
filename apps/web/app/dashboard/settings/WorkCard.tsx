"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BuildingRegular, SpinnerIosRegular, AddRegular } from "@fluentui/react-icons";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import type { PendingCompanyVerification, ProfileCompanyView } from "@/components/companies/types";

const labelCls =
  "mb-0.5 flex items-center gap-1 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted";

/**
 * The Work section of Settings — reached from "Edit Profile" on the profile
 * page, which is why the company lives here as well as under the name on the
 * profile itself.
 *
 * A company is only ever set by proving a work email (see AddCompanyModal), so
 * this card has no free-text field: it shows what is verified, and offers the
 * two things a member can do about it — add/change, or remove.
 */
export function WorkCard({
  company,
  pending,
}: {
  company: ProfileCompanyView | null;
  pending: PendingCompanyVerification | null;
}) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch("/api/companies/membership", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setRemoveError(data.message ?? "Couldn't remove the company. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setRemoveError("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section
      aria-labelledby="work-heading"
      className="mt-5 rounded-2xl border border-border bg-surface px-5 py-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="work-heading" className="font-display text-[15px] font-semibold text-foreground">
          Work
        </h2>
        {company && (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="font-body text-xs font-medium text-accent transition-opacity hover:opacity-80"
          >
            Change
          </button>
        )}
      </div>

      <div className="mt-4">
        {company ? (
          <div className="flex items-center gap-3">
            <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={38} />
            <div className="min-w-0 flex-1">
              <Link
                href={`/dashboard/companies/${company.slug}`}
                className="block truncate font-body text-sm font-medium text-foreground transition-colors hover:text-accent"
              >
                {company.name}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-2">
                {company.domain ? (
                  <span className="font-body text-xs text-foreground-muted">{company.domain}</span>
                ) : (
                  <span className={labelCls}>
                    <BuildingRegular fontSize={11} /> No verified domain
                  </span>
                )}
                {company.isActive && company.domainVerified && <VerifiedMark size="xs" />}
                {!company.isActive && (
                  <span className="font-body text-xs text-foreground-subtle">No longer active</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              {removing && <SpinnerIosRegular fontSize={13} className="animate-spin" />}
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-left transition-colors hover:border-accent/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-raised text-foreground-muted">
              <AddRegular fontSize={17} />
            </span>
            <span className="min-w-0">
              <span className="block font-body text-sm font-medium text-foreground">
                Add your company
              </span>
              <span className="block font-body text-xs text-foreground-muted">
                Verified with your work email
              </span>
            </span>
          </button>
        )}

        {pending && (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-left transition-colors hover:border-accent/40"
          >
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-foreground-muted">
              Pending
            </span>
            <span className="min-w-0 font-body text-xs text-foreground-muted">
              Enter the code we emailed to {pending.maskedEmail} to finish adding{" "}
              {pending.companyName}.
            </span>
          </button>
        )}

        {removeError && (
          <p className="mt-3 font-body text-xs text-foreground-muted" role="alert">
            {removeError}
          </p>
        )}

        <p className="mt-3 font-body text-[11px] leading-relaxed text-foreground-subtle">
          A verified company means you control a work email on that company&apos;s domain. It
          doesn&apos;t make you an official representative of the company.
        </p>
      </div>

      {/* Mounted only while open, so each visit to the picker starts clean. */}
      {showPicker && (
        <AddCompanyModal
          open
          onClose={() => setShowPicker(false)}
          initialPending={pending}
          onVerified={() => router.refresh()}
        />
      )}
    </section>
  );
}
