"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Check, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  checkWorkEmail,
  companyNameMatchesDomain,
  domainFromEmail,
  suggestedCompanyName,
} from "@/lib/companies/domains";
import { CompanyLogo, VerifiedMark } from "./CompanyBadge";
import type { CompanyOption, PendingCompanyVerification } from "./types";

/**
 * "Where do you work?" — search a company, or create the one that is missing.
 *
 * The flow is deliberately two-phase because the trust signal is a verified
 * DOMAIN, not a company name:
 *
 *   search → pick an existing company (or name a new one)
 *          → give a work email, which is the domain being claimed
 *          → enter the code we mail to it
 *          → the domain decides the company
 *
 * Everything that could grant a membership is decided by the server: this
 * component only collects the member's choices and renders the answer,
 * including the case where the domain turns out to belong to a different
 * company (it offers that company instead of letting the member through).
 */

type Step = "search" | "email" | "verify" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  /** An outstanding challenge, so reopening lands straight on the code step. */
  initialPending?: PendingCompanyVerification | null;
  /** Called once a membership is proven, so the page behind the modal refreshes. */
  onVerified?: () => void;
}

const fieldCls =
  "w-full rounded-md border border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent focus:ring-2 focus:ring-accent/20";

const HITS_PAGE_SIZE = 8;

/**
 * A refusal the server returned, with the company it suggests instead when it
 * knows one. "That domain belongs to Figma" is only useful if the member can
 * act on it, so the offer to join Figma sits right under it.
 */
function FailureNotice({
  failure,
  onJoin,
}: {
  failure: { message: string; company?: CompanyOption };
  onJoin: (company: CompanyOption) => void;
}) {
  const target = failure.company?.id ? failure.company : null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
      <p className="font-body text-xs leading-relaxed text-foreground-muted">{failure.message}</p>
      {target && (
        <button
          type="button"
          onClick={() => onJoin(target)}
          className="mt-2 font-body text-xs font-medium text-accent hover:underline"
        >
          Join {target.name} instead
        </button>
      )}
    </div>
  );
}

export function AddCompanyModal({ open, onClose, initialPending = null, onVerified }: Props) {
  // State is initialised from props and never reset from an effect: the callers
  // mount this component when the picker opens and unmount it on close, so a
  // previous attempt cannot leak into the next one.
  const [step, setStep] = useState<Step>(initialPending ? "verify" : "search");

  // Search
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  // Selection: an existing company, or a name for one that does not exist yet.
  // A challenge that was opened before this visit names its company, so
  // reopening lands on a filled-in form rather than an empty one.
  const [selected, setSelected] = useState<CompanyOption | null>(
    initialPending?.companyId
      ? { id: initialPending.companyId, name: initialPending.companyName }
      : null
  );
  const [newName, setNewName] = useState(initialPending?.companyId ? "" : initialPending?.companyName ?? "");

  // Work email
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFailure, setFormFailure] = useState<{
    code: string;
    message: string;
    company?: CompanyOption;
  } | null>(null);

  // Verification
  const [pending, setPending] = useState<PendingCompanyVerification | null>(initialPending);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Result. `domainVerified` is false when the code proved the mailbox but the
  // company's claim on the domain was too weak to settle it (verified_via
  // `mailbox_only`) — the membership is real, the verified mark is not earned.
  const [verified, setVerified] = useState<{
    name: string;
    slug: string;
    domain: string | null;
    domainVerified: boolean;
  } | null>(null);

  // Directory search, debounced. The empty query browses the directory.
  useEffect(() => {
    if (!open || step !== "search") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchFailed(false);
      try {
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { companies?: CompanyOption[] };
        setHits(data.companies ?? []);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSearchFailed(true);
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, step, query]);

  useEffect(() => {
    if (step === "verify") {
      setTimeout(() => codeRef.current?.focus({ preventScroll: true }), 20);
    }
  }, [step]);

  const trimmedQuery = query.trim();
  const emailCheck = email.trim() ? checkWorkEmail(email) : null;
  const emailInvalid = emailCheck?.ok === false ? emailCheck : null;

  // The domain a new company will be verified by comes from the work email, so
  // the name can be checked against it before the member submits — the server
  // enforces the same rule, this just says it early and offers the fix.
  const claimedDomain = domainFromEmail(email);
  const nameMismatch =
    !selected && newName.trim() && claimedDomain
      ? companyNameMatchesDomain(newName, claimedDomain)
      : null;
  const nameSuggestion = claimedDomain ? suggestedCompanyName(claimedDomain) : "";

  const startVerification = useCallback(
    async (payload: {
      company_id?: string | null;
      company_name?: string | null;
      work_email?: string;
      verification_id?: string;
    }) => {
      setSubmitting(true);
      setFormError(null);
      setFormFailure(null);
      setCodeError(null);

      try {
        const res = await fetch("/api/companies/verifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          pending?: PendingCompanyVerification;
          error?: string;
          message?: string;
          company?: CompanyOption;
        };

        if (!res.ok || !data.pending) {
          setFormFailure({
            code: data.error ?? "unexpected",
            message: data.message ?? "Couldn't send the verification email. Please try again.",
            company: data.company,
          });
          return false;
        }

        setPending(data.pending);
        setAttemptsLeft(data.pending.attemptsLeft);
        setStep("verify");
        return true;
      } catch {
        setFormFailure({
          code: "network",
          message: "Network error. Please try again.",
        });
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  async function handleSendCode() {
    const check = checkWorkEmail(email);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    await startVerification({
      // A company id is a hint the database re-validates against the domain;
      // without one, the typed name is the label for the domain being proven.
      company_id: selected?.id ?? null,
      company_name: selected ? null : newName.trim(),
      work_email: email.trim(),
    });
  }

  async function handleResend() {
    if (!pending) return;
    // The raw work email never reaches the browser, so a resend names the
    // member's own challenge and the server reads the address back from it.
    await startVerification({ verification_id: pending.id });
  }

  async function handleConfirm(entered: string) {
    if (!pending) return;
    setVerifying(true);
    setCodeError(null);

    try {
      const res = await fetch("/api/companies/verifications/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verification_id: pending.id, code: entered }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        /** The verified company, or the company the member should join instead. */
        company?: CompanyOption & { verifiedVia?: string };
        error?: string;
        message?: string;
        attemptsLeft?: number | null;
      };

      // A success always carries a slug (the company page), a refusal never does.
      if (res.ok && data.company?.slug) {
        setVerified({
          name: data.company.name,
          slug: data.company.slug,
          domain: data.company.domain ?? null,
          domainVerified: data.company.verifiedVia !== "mailbox_only",
        });
        setPending(null);
        setStep("done");
        onVerified?.();
        return;
      }

      if (
        data.error === "domain_already_verified" ||
        data.error === "domain_not_verified"
      ) {
        // The domain moved out from under this challenge: send the member back
        // to search with the reason, rather than letting them retry a code that
        // can no longer grant membership.
        setPending(null);
        setStep("search");
        setFormFailure({
          code: data.error,
          message: data.message ?? "That domain is no longer available for this company.",
          company: data.company,
        });
        return;
      }

      setCodeError(data.message ?? "That code doesn't match. Check the email and try again.");
      if (typeof data.attemptsLeft === "number") setAttemptsLeft(data.attemptsLeft);
      setCode("");

      if (data.error === "expired" || data.error === "already_used" || data.error === "not_found") {
        setPending(null);
        setStep("search");
        setFormFailure({
          code: data.error,
          message: data.message ?? "That verification expired. Start again.",
        });
      }
    } catch {
      setCodeError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  function handleCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setCodeError(null);
    if (digits.length === 6) void handleConfirm(digits);
  }

  function chooseExisting(company: CompanyOption) {
    setSelected(company);
    setFormFailure(null);
    setFormError(null);
    setStep("email");
  }

  function chooseNew() {
    setSelected(null);
    setNewName(trimmedQuery);
    setFormFailure(null);
    setFormError(null);
    setStep("email");
  }

  const title =
    step === "search"
      ? "Where do you work?"
      : step === "email"
        ? "Verify your work email"
        : step === "verify"
          ? "Check your inbox"
          : "Company added";

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      {/* ── 1. Search: existing companies, or create one ── */}
      {step === "search" && (
        <div>
          <div className="relative">
            <Search
              strokeWidth={2.5}
              size={14}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company"
              aria-label="Search company"
              className={`${fieldCls} pl-9`}
            />
            {searching && (
              <Loader2
                strokeWidth={2.5}
                size={14}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-foreground-muted"
              />
            )}
          </div>

          {formFailure && <FailureNotice failure={formFailure} onJoin={chooseExisting} />}

          <div className="mt-4 max-h-72 overflow-y-auto">
            {hits.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {hits.slice(0, HITS_PAGE_SIZE).map((company) => (
                  <li key={company.id}>
                    <button
                      type="button"
                      onClick={() => chooseExisting(company)}
                      className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-raised"
                    >
                      <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-body text-sm font-medium text-foreground">
                          {company.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          {company.domain ? (
                            <span className="truncate font-body text-xs text-foreground-muted">
                              {company.domain}
                            </span>
                          ) : (
                            <span className="font-body text-xs text-foreground-subtle">
                              No domain on file yet
                            </span>
                          )}
                          {company.verified && <VerifiedMark size="xs" />}
                        </span>
                      </span>
                      {typeof company.memberCount === "number" && company.memberCount > 0 && (
                        <span className="shrink-0 font-body text-[11px] text-foreground-subtle">
                          {company.memberCount} {company.memberCount === 1 ? "member" : "members"}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 font-body text-xs text-foreground-muted">
                {searching
                  ? "Searching…"
                  : searchFailed
                    ? "Couldn't load companies. Check your connection and try again."
                    : "No companies match that yet."}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={chooseNew}
            disabled={!trimmedQuery}
            className="mt-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-left transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-raised text-foreground-muted">
              <Building2 strokeWidth={2.5} size={14} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-body text-sm font-medium text-foreground">
                {trimmedQuery ? `Create “${trimmedQuery}”` : "Add a company"}
              </span>
              <span className="block font-body text-xs text-foreground-muted">
                {trimmedQuery
                  ? "We'll verify it with your work email"
                  : "Search for your company, or type its name"}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ── 2. Work email — the domain being claimed ── */}
      {step === "email" && (
        <div>
          <button
            type="button"
            onClick={() => setStep("search")}
            className="mb-4 flex items-center gap-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft strokeWidth={2.5} size={12} />
            Back to search
          </button>

          <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3">
            <CompanyLogo
              name={selected?.name ?? (newName.trim() || "?")}
              logoUrl={selected?.logoUrl}
              size={36}
            />
            <div className="min-w-0 flex-1">
              {selected ? (
                <>
                  <p className="truncate font-body text-sm font-medium text-foreground">
                    {selected.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2">
                    {selected.domain && (
                      <span className="truncate font-body text-xs text-foreground-muted">
                        {selected.domain}
                      </span>
                    )}
                    {selected.verified && <VerifiedMark size="xs" />}
                  </p>
                </>
              ) : (
                <>
                  <p className="truncate font-body text-sm font-medium text-foreground">
                    {newName.trim()}
                  </p>
                  <p className="mt-0.5 font-body text-xs text-foreground-muted">
                    New company · verified by {claimedDomain ?? "your work email domain"}
                  </p>
                </>
              )}
            </div>
          </div>

          {!selected && (
            <div className="mb-4">
              <label
                htmlFor="company-name"
                className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
              >
                Company name
              </label>
              <input
                id="company-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Figma"
                maxLength={120}
                className={fieldCls}
              />
            </div>
          )}

          <label
            htmlFor="company-work-email"
            className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
          >
            Work email
          </label>
          <input
            id="company-work-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFormError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) void handleSendCode();
            }}
            placeholder="you@company.com"
            autoComplete="email"
            className={fieldCls}
          />

          <p
            className={`mt-2 font-body text-xs ${
              emailInvalid || formError ? "text-foreground-muted" : "text-foreground-subtle"
            }`}
            role={emailInvalid || formError ? "alert" : undefined}
          >
            {formError ??
              emailInvalid?.message ??
              "We'll email a code to prove you work there. It verifies the domain, not a job title."}
          </p>

          {/* The name has to correspond to the domain being proved, because the
              domain is what the verified mark means. The server enforces this;
              saying it here lets the member fix it before submitting. */}
          {nameMismatch?.ok === false && claimedDomain && (
            <div className="mt-3 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
              <p className="font-body text-xs leading-relaxed text-foreground-muted">
                A company is named after the domain it proves. “{newName.trim()}” doesn&apos;t
                match {claimedDomain}, and members see the domain beside the name.
              </p>
              {nameSuggestion && (
                <button
                  type="button"
                  onClick={() => setNewName(nameSuggestion)}
                  className="mt-2 font-body text-xs font-medium text-accent hover:underline"
                >
                  Use “{nameSuggestion}” instead
                </button>
              )}
            </div>
          )}

          {formFailure && <FailureNotice failure={formFailure} onJoin={chooseExisting} />}

          <button
            type="button"
            onClick={handleSendCode}
            disabled={
              submitting ||
              !email.trim() ||
              Boolean(emailInvalid) ||
              (!selected && !newName.trim()) ||
              nameMismatch?.ok === false
            }
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 strokeWidth={2.5} size={14} className="animate-spin" />}
            Send verification code
          </button>
        </div>
      )}

      {/* ── 3. The code ── */}
      {step === "verify" && pending && (
        <div>
          <p className="font-body text-sm leading-relaxed text-foreground-muted">
            We emailed a 6-digit code to{" "}
            <span className="font-medium text-foreground">{pending.maskedEmail}</span>. Enter it
            to verify <span className="font-medium text-foreground">{pending.domain}</span>.
          </p>

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3">
            <CompanyLogo name={pending.companyName} size={34} />
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-medium text-foreground">
                {pending.companyName}
              </p>
              <p className="mt-0.5 font-body text-xs text-foreground-muted">{pending.domain}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-foreground-muted">
              Pending
            </span>
          </div>

          <label
            htmlFor="company-verification-code"
            className="mt-5 mb-1 block font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
          >
            Verification code
          </label>
          <input
            id="company-verification-code"
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.length === 6 && !verifying) void handleConfirm(code);
            }}
            placeholder="000000"
            disabled={verifying}
            className={`${fieldCls} text-center font-mono text-lg tracking-[0.4em]`}
          />

          {(codeError || verifying) && (
            <p className="mt-2 flex items-center gap-1.5 font-body text-xs text-foreground-muted" role="alert">
              {verifying && <Loader2 strokeWidth={2.5} size={12} className="animate-spin" />}
              {verifying ? "Verifying…" : codeError}
            </p>
          )}

          {typeof attemptsLeft === "number" && attemptsLeft < 5 && !codeError && (
            <p className="mt-2 font-body text-xs text-foreground-subtle">
              {attemptsLeft} {attemptsLeft === 1 ? "try" : "tries"} left before the code is burned.
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={submitting}
              className="font-body text-xs font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="font-body text-xs text-foreground-muted transition-colors hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        </div>
      )}

      {/* ── 4. Done ── */}
      {step === "done" && verified && (
        <div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Check strokeWidth={2.5} size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-medium text-foreground">
                {verified.name}
              </p>
              {verified.domain && (
                <p className="mt-0.5 flex items-center gap-2">
                  <span className="font-body text-xs text-foreground-muted">{verified.domain}</span>
                  {verified.domainVerified && <VerifiedMark size="xs" />}
                </p>
              )}
            </div>
          </div>

          <p className="mt-4 font-body text-xs leading-relaxed text-foreground-subtle">
            We verified your work email on that domain. It shows you control a mailbox there — not
            that you speak for the company.
          </p>

          <div className="mt-5 flex items-center justify-between gap-3">
            <Link
              href={`/dashboard/companies/${verified.slug}`}
              className="font-body text-xs font-medium text-accent hover:underline"
            >
              View company page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
