"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { companyLogoUrl } from "@/lib/companies/logos";

/**
 * Admin directory for the companies the "Where do you work?" picker offers.
 *
 * The list is the app's own directory (public.companies / public.company_domains),
 * so there is nothing to sync: a company added here is searchable in the app at
 * once, deactivating hides it, and deleting removes it and its domain hint.
 *
 * Adding writes an UNVERIFIED hint, never a proof — the same rule a member's
 * flow keeps. The verified mark in the table means a member has proved a work
 * email on that domain; an admin can prepare a row but cannot mint a proof.
 */

interface AdminCompany {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  domain: string | null;
  domain_verified: boolean;
  domain_count: number;
  member_count: number;
  total_count: number;
}

const fieldCls =
  "w-full rounded-md border border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent focus:ring-2 focus:ring-accent/20";

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function AddCompanyModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedDomain = domain.trim().toLowerCase();
  const domainInvalid = trimmedDomain.length > 0 && !DOMAIN_RE.test(trimmedDomain);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedName) {
      setError("Enter a company name.");
      return;
    }
    if (domainInvalid) {
      setError("Enter a domain like figma.com, or leave it blank.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, domain: trimmedDomain || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? "Failed to add the company.");
        return;
      }
      onAdded(trimmedName);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add company" maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <label htmlFor="admin-company-name" className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          Company name
        </label>
        <input
          id="admin-company-name"
          autoFocus
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="e.g. Figma"
          maxLength={120}
          className={fieldCls}
        />

        <label htmlFor="admin-company-domain" className="mt-4 mb-1 block font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          Work domain <span className="font-normal normal-case text-foreground-subtle">(optional)</span>
        </label>
        <input
          id="admin-company-domain"
          type="text"
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setError(null); }}
          placeholder="figma.com"
          maxLength={253}
          className={fieldCls}
        />

        <p className="mt-2 font-body text-xs leading-relaxed text-foreground-subtle">
          The domain makes the company searchable in the app and gives it a logo. It stays
          unverified until a member proves a work email on it — an admin can prepare a company,
          not a proof.
        </p>

        {error && <p className="mt-3 font-body text-xs text-red-400" role="alert">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !trimmedName || domainInvalid}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 strokeWidth={2.5} size={14} className="animate-spin" /> : <Plus strokeWidth={2.5} size={14} />}
            Add company
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CompaniesAdminPage() {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminCompany | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/companies?all=true", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { companies?: AdminCompany[] };
      setCompanies(data.companies ?? []);
    } catch {
      setLoadError(true);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  const tabItems = useMemo(
    () => companies.filter((c) => (tab === "active" ? c.is_active : !c.is_active)),
    [companies, tab]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabItems;
    return tabItems.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.domain ?? "").toLowerCase().includes(q)
    );
  }, [tabItems, search]);

  async function toggleActive(company: AdminCompany) {
    setBusyId(company.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !company.is_active }),
      });
      if (!res.ok) {
        setNotice("Couldn't update that company.");
        return;
      }
      setCompanies((rows) =>
        rows.map((row) => (row.id === company.id ? { ...row, is_active: !row.is_active } : row))
      );
      setNotice(
        company.is_active
          ? `“${company.name}” is now hidden from the app.`
          : `“${company.name}” is back in the app.`
      );
    } catch {
      setNotice("Network error. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) {
        setNotice("Couldn't delete that company.");
        return;
      }
      setCompanies((rows) => rows.filter((row) => row.id !== deleting.id));
      setNotice(`“${deleting.name}” was removed from the app.`);
      setDeleting(null);
    } catch {
      setNotice("Network error. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const activeCount = companies.filter((c) => c.is_active).length;
  const inactiveCount = companies.length - activeCount;

  return (
    <div>
      {/* Header */}
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-foreground">Companies</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          <Plus strokeWidth={2.5} size={13} />
          Add company
        </button>
      </div>
      <p className="mb-5 max-w-2xl font-body text-xs leading-relaxed text-foreground-muted">
        These are the companies the app shows in “Where do you work?”. Adding one here makes it
        searchable in the app immediately; deactivating hides it; deleting removes it for everyone.
      </p>

      {notice && (
        <p className="mb-3 rounded-md border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground-muted">
          {notice}
        </p>
      )}

      {/* Tabs */}
      <div className="mb-3 flex gap-1 border-b border-border">
        {(["active", "inactive"] as const).map((key) => {
          const count = key === "active" ? activeCount : inactiveCount;
          return (
            <button
              key={key}
              onClick={() => { setTab(key); setSearch(""); }}
              className={`-mb-px border-b-2 px-4 py-2 font-body text-xs font-medium capitalize transition-colors ${
                tab === key ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {key}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                tab === key ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies…"
          className="field w-full pl-8 pr-8"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X strokeWidth={2.5} size={12} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-4 w-4" />
          </div>
        ) : loadError ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            Couldn&apos;t load companies. Reload the page to try again.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            {search ? `No companies match “${search}”.` : `No ${tab} companies yet.`}
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="w-14 px-4 py-2" />
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">Name</th>
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">Domain</th>
                <th className="px-4 py-2 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">Members</th>
                <th className="px-4 py-2 text-right font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company, idx) => (
                <tr key={company.id} className={idx < filtered.length - 1 ? "border-b border-border-subtle" : ""}>
                  <td className="px-4 py-2.5">
                    <CompanyLogo
                      name={company.name}
                      logoUrl={companyLogoUrl(company.logo_url, company.domain)}
                      size={26}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`font-body text-xs ${company.is_active ? "text-foreground" : "text-foreground-muted line-through"}`}>
                      {company.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {company.domain ? (
                      <span className="flex items-center gap-2">
                        <span className="font-body text-xs text-foreground-muted">{company.domain}</span>
                        {company.domain_verified && <VerifiedMark size="xs" label={false} />}
                        {company.domain_count > 1 && (
                          <span className="font-body text-[10px] text-foreground-subtle">+{company.domain_count - 1}</span>
                        )}
                      </span>
                    ) : (
                      <span className="font-body text-xs text-foreground-subtle">No domain</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-body text-xs text-foreground-muted">
                      {company.member_count > 0 ? company.member_count : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => toggleActive(company)}
                        disabled={busyId === company.id}
                        className="rounded-md border border-border px-2.5 py-1 font-body text-[11px] text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        {busyId === company.id ? (
                          <Loader2 strokeWidth={2.5} size={12} className="animate-spin" />
                        ) : company.is_active ? (
                          "Deactivate"
                        ) : (
                          "Activate"
                        )}
                      </button>
                      <button
                        onClick={() => { setDeleting(company); setNotice(null); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                        aria-label={`Delete ${company.name}`}
                      >
                        <Trash2 strokeWidth={2.5} size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !loadError && tabItems.length > 0 && (
        <p className="mt-2 text-right font-body text-[10px] text-foreground-muted">
          {search ? `${filtered.length} of ${tabItems.length}` : tabItems.length} {tab} {tabItems.length === 1 ? "company" : "companies"}
        </p>
      )}

      {addOpen && (
        <AddCompanyModal
          onClose={() => setAddOpen(false)}
          onAdded={(name) => {
            setAddOpen(false);
            setNotice(`“${name}” was added to the app.`);
            setTab("active");
            void load();
          }}
        />
      )}

      {deleting && (
        <Modal open onClose={() => (deleteBusy ? undefined : setDeleting(null))} title="Delete company" maxWidth="max-w-md">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-400">
              <Building2 strokeWidth={2.5} size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-medium text-foreground">{deleting.name}</p>
              {deleting.domain && <p className="mt-0.5 font-body text-xs text-foreground-muted">{deleting.domain}</p>}
            </div>
          </div>

          <p className="mt-4 font-body text-xs leading-relaxed text-foreground-subtle">
            This removes the company from “Where do you work?” for everyone and deletes its domain
            hint.
            {deleting.member_count > 0 && (
              <>
                {" "}
                <span className="text-foreground-muted">
                  {deleting.member_count} {deleting.member_count === 1 ? "member has" : "members have"} proved a
                  work email here; their membership goes too.
                </span>
              </>
            )}{" "}
            Deactivate it instead to keep the record and just hide it.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
              className="rounded-md border border-border px-4 py-2 font-body text-sm text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleteBusy}
              className="flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 font-body text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deleteBusy ? <Loader2 strokeWidth={2.5} size={14} className="animate-spin" /> : <Check strokeWidth={2.5} size={14} />}
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
