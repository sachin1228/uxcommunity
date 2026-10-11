"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus } from "lucide-react";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import { EditProfileForm } from "@/components/profile/EditProfileForm";
import type { ProfileIdentityPayload } from "@/lib/profile/identity";
import type {
  PendingCompanyVerification,
  ProfileCompanyView,
} from "@/components/companies/types";

interface ProfileSectionProps {
  /** Current identity values, select options, groups and cooldown locks. */
  identity: ProfileIdentityPayload;
  /** The verified company on the profile, or null when none is set. */
  company: ProfileCompanyView | null;
  /** A work-email challenge still waiting on a code, so the picker reopens into it. */
  pendingCompany: PendingCompanyVerification | null;
}

/**
 * Profile — the identity fields a member picked at signup (name, city,
 * industry sector, job title, experience level) and the company that verifies
 * where they work. This is where the profile page's Edit Profile button lands:
 * the hero stays a view, and every editable detail lives here.
 *
 * The form reports its own success inline; this component only refreshes the
 * page behind it (the sidebar and the hero) once a save lands or a company is
 * verified.
 */
export function ProfileSection({ identity, company, pendingCompany }: ProfileSectionProps) {
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

  // An identity edit moves the member between official communities, so the
  // sidebar and explore caches are stale by definition — bust them, then let
  // the server render re-supply the page with the new values.
  function handleIdentitySaved() {
    invalidateCommunitiesList();
    router.refresh();
  }

  return (
    <section
      aria-labelledby="settings-profile-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <div>
        <h2 id="settings-profile-heading" className="font-display text-[15px] font-semibold text-foreground">
          Profile
        </h2>
        <p className="mt-0.5 font-body text-xs text-foreground-muted">
          Your name, role, city and workplace as they appear to everyone.
        </p>
      </div>

      <EditProfileForm data={identity} onSaved={handleIdentitySaved} />

      {/* The company is managed here now that the profile page is a view. */}
      <div className="border-t border-border pt-4">
        <p className="font-body text-xs font-medium text-foreground">Company</p>
        <p className="mt-0.5 font-body text-xs text-foreground-muted">
          Prove a work email to show the company you work for.
        </p>

        <div className="mt-3">
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
        </div>
      </div>

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
