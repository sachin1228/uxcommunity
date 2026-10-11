"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus } from "lucide-react";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import type {
  PendingCompanyVerification,
  ProfileCompanyView,
} from "@/components/companies/types";

interface CompanySectionProps {
  /** The verified company on the profile, or null when none is set. */
  company: ProfileCompanyView | null;
  /** A work-email challenge still waiting on a code, so the picker reopens into it. */
  pendingCompany: PendingCompanyVerification | null;
}

/**
 * Company — the workplace shown on the profile, proved by a work email. Its own
 * card, beside Profile, because it is the one detail with a verification step
 * rather than a field the member edits directly.
 *
 * The picker itself is the shared AddCompanyModal; this card only reflects the
 * member's current company and refreshes the page behind it once a membership
 * is proven.
 */
export function CompanySection({ company, pendingCompany }: CompanySectionProps) {
  const router = useRouter();
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(pendingCompany);

  // A newer server render (a refresh, a navigation) supersedes whatever a
  // verification left in state — adjusted during render, like the profile hero.
  const [serverPending, setServerPending] = useState(pendingCompany);
  if (serverPending !== pendingCompany) {
    setServerPending(pendingCompany);
    setPendingVerification(pendingCompany);
  }

  return (
    <section
      aria-labelledby="settings-company-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <div>
        <h2 id="settings-company-heading" className="font-display text-[15px] font-semibold text-foreground">
          Company
        </h2>
        <p className="mt-0.5 font-body text-xs text-foreground-muted">
          Prove a work email to show the company you work for.
        </p>
      </div>

      {company ? (
        <div className="flex w-fit max-w-full flex-wrap items-center gap-2">
          <div
            className={`flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 font-body text-xs ${
              company.isActive ? "text-foreground" : "text-foreground-subtle"
            }`}
          >
            <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={16} />
            <span className="truncate">{company.name}</span>
            {company.isActive && company.domainVerified && (
              <VerifiedMark label={false} size="xs" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCompanyPicker(true)}
            title={
              company.isActive
                ? company.domainVerified && company.domain
                  ? `Verified via ${company.domain} — change it`
                  : "Change company"
                : "This company is no longer active — add another"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
          >
            <PenLine strokeWidth={2.5} size={11} />
            Edit
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCompanyPicker(true)}
          className="flex w-fit items-center gap-1.5 rounded-xl border border-dashed border-border bg-background px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Plus strokeWidth={2.5} size={12} />
          Add your company
        </button>
      )}

      {/* Mounted only while open: the picker's state is per-attempt, so
          unmounting it is what resets the search, the email and the code. */}
      {showCompanyPicker && (
        <AddCompanyModal
          open
          onClose={() => setShowCompanyPicker(false)}
          initialPending={pendingVerification}
          onVerified={() => {
            setPendingVerification(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
