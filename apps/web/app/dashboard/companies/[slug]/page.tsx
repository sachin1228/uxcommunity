import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompanyPage } from "@/lib/companies/service";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { BackLink } from "@/components/ui/BackLink";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Company: ${slug}` };
}

/**
 * A company page: what the company is, the domains its members proved, and who
 * works there.
 *
 * The page deliberately shows verified domains rather than member work emails,
 * and it labels only what verification actually proves — that each member
 * controls a mailbox on one of those domains. It says nothing about who
 * represents or administers the company.
 */
export default async function CompanyPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { slug } = await params;
  const company = await getCompanyPage(createServiceClient(), slug);
  if (!company) notFound();

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <BackLink
        href="/dashboard/profile"
        label="Back to profile"
        className="mb-5 inline-flex items-center gap-2 font-body text-xs text-foreground-muted transition-colors hover:text-foreground"
      />

      <section
        aria-label="Company details"
        className="overflow-hidden rounded-2xl border border-border bg-surface"
      >
        {/* A dark cover: deliberately theme-independent, not token-driven. */}
        <div
          className="h-24 w-full bg-[#141417]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.065) 0px, rgba(255,255,255,0.065) 1px, transparent 1px, transparent 9px)",
          }}
        />

        <div className="relative px-5 pb-5">
          <div className="-mt-9 flex items-end gap-4">
            <div className="shrink-0">
              <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={68} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-display text-xl font-semibold text-foreground">{company.name}</h1>
            {!company.isActive && (
              <span className="rounded-full border border-border bg-surface-raised px-2.5 py-0.5 font-body text-[10px] uppercase tracking-wider text-foreground-muted">
                No longer active
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {company.domains.length > 0 ? (
              company.domains.map((entry) => (
                <span key={entry.domain} className="flex items-center gap-1.5">
                  <span className="font-body text-sm text-foreground-muted">{entry.domain}</span>
                  <VerifiedMark size="xs" />
                </span>
              ))
            ) : (
              <span className="font-body text-sm text-foreground-subtle">
                No verified domains yet
              </span>
            )}
          </div>

          <p className="mt-2 flex items-center gap-1.5 font-body text-sm text-foreground-muted">
            <Users strokeWidth={2.5} size={12} className="text-accent" />
            {company.memberCount} {company.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
      </section>

      <section
        aria-labelledby="company-members-heading"
        className="mt-6 rounded-2xl border border-border bg-surface px-5 py-5"
      >
        <h2
          id="company-members-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          People here
        </h2>

        {company.members.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {company.members.map((member, index) => (
              <li key={`${member.name}-${index}`} className="flex items-center gap-3">
                <span className="h-8 w-8 overflow-hidden rounded-full border border-border bg-accent/20">
                  <AvatarImg
                    url={member.avatarUrl}
                    name={member.name}
                    size={32}
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate font-body text-sm text-foreground">
                  {member.name}
                </span>
                <VerifiedMark size="xs" label={false} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 font-body text-sm text-foreground-muted">
            Nobody has verified a work email here yet.
          </p>
        )}

        {company.members.length > 0 && (
          <p className="mt-4 font-body text-[11px] leading-relaxed text-foreground-subtle">
            Each member verified a work email on one of this company&apos;s domains. That proves
            they control a mailbox there — not that they represent or administer the company.
          </p>
        )}
      </section>
    </div>
  );
}
