"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type Status = "unverified" | "pending" | "approved" | "rejected";

interface LatestApplication {
  id: string;
  status: string;
  linkedinUrl: string;
  portfolioLinks: string[];
  workSampleUrls: string[];
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/**
 * A thumbnail. New uploads carry a key; existing samples use the
 * authorization-gated proxy path returned by the server. A proxy-path sample
 * is display/reference only and is resolved back to a key server-side.
 */
interface Sample {
  key: string;
  url: string;
}

function samplesFromLatest(latest: LatestApplication): Sample[] {
  return latest.workSampleUrls.map((url) => ({ key: "", url }));
}

interface VerificationData {
  status: Status;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  reapplyAt: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  latest: LatestApplication | null;
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const EMPTY: VerificationData = {
  status: "unverified",
  name: "",
  email: "",
  emailVerifiedAt: null,
  reapplyAt: null,
  rejectionReason: null,
  reviewedAt: null,
  latest: null,
};

function StatusCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: "green" | "amber" | "red";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    green: "border-green-500/30 bg-green-500/10",
    amber: "border-amber-500/30 bg-amber-500/10",
    red: "border-red-500/30 bg-red-500/10",
  } as const;
  return (
    <div className={`rounded-xl border ${tones[tone]} p-5`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-display text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="mt-2 font-body text-xs leading-relaxed text-foreground-muted">{children}</div>
    </div>
  );
}

export function VerificationForm() {
  const router = useRouter();
  const [data, setData] = useState<VerificationData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [linkedin, setLinkedin] = useState("");
  const [portfolio1, setPortfolio1] = useState("");
  const [portfolio2, setPortfolio2] = useState("");
  const [showSecondPortfolio, setShowSecondPortfolio] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => {
      setCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/verification");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load verification.");
        if (!active) return;
        const next = body as VerificationData;
        setData(next);
        setEmailVerifiedAt(next.emailVerifiedAt);
        if (next.latest) {
          setLinkedin(next.latest.linkedinUrl ?? "");
          setPortfolio1(next.latest.portfolioLinks[0] ?? "");
          setPortfolio2(next.latest.portfolioLinks[1] ?? "");
          setShowSecondPortfolio(Boolean(next.latest.portfolioLinks[1]));
          setSamples(samplesFromLatest(next.latest));
        }
      } catch (loadFailure) {
        if (active) {
          setLoadError(
            loadFailure instanceof Error ? loadFailure.message : "Failed to load verification.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function sendCode() {
    setSendingCode(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/verification/email/send", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof body.retryAfter === "number") setCooldown(body.retryAfter);
        setError(body.error ?? "Could not send the code.");
        return;
      }
      if (body.alreadyVerified) {
        setEmailVerifiedAt(new Date().toISOString());
        setNotice("Your email is already verified.");
        return;
      }
      setCooldown(60);
      setNotice(`Code sent to ${body.email ?? data.email}. Check your inbox.`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSendingCode(false);
    }
  }

  async function confirmCode() {
    setConfirmingCode(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/verification/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That code is incorrect.");
        return;
      }
      setEmailVerifiedAt(body.emailVerifiedAt ?? new Date().toISOString());
      setCode("");
      setNotice("Email verified.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConfirmingCode(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = 3 - samples.length;
    if (room <= 0) {
      setError("You can upload up to 3 work samples.");
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (file.size > 5 * 1024 * 1024) {
          setError(`${file.name} is over 5 MB.`);
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/verification/upload", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error ?? "Upload failed.");
          continue;
        }
        const next: Sample = { key: String(body.key ?? ""), url: String(body.url ?? "") };
        setSamples((current) =>
          current.some((sample) => sample.key === next.key && sample.url === next.url)
            ? current
            : [...current, next],
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function removeSample(sample: Sample) {
    setSamples((current) => current.filter((value) => value !== sample));
    if (!sample.key) {
      // Existing evidence is referenced by proxy path; removing it from this
      // form must not delete the previous request's object.
      return;
    }
    await fetch(`/api/verification/upload?key=${encodeURIComponent(sample.key)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setNotice(null);

    const portfolioLinks = [portfolio1, portfolio2]
      .map((value) => value.trim())
      .filter(Boolean);

    if (!linkedin.trim()) {
      setError("Your LinkedIn profile is required.");
      setSubmitting(false);
      return;
    }
    if (portfolioLinks.length === 0) {
      setError("Add at least one portfolio link.");
      setSubmitting(false);
      return;
    }
    if (!emailVerifiedAt) {
      setError("Verify your account email before submitting.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/verification/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: linkedin.trim(),
          portfolio_links: portfolioLinks,
          work_sample_keys: samples.map((sample) => sample.key).filter(Boolean),
          work_sample_refs: samples.filter((sample) => !sample.key).map((sample) => sample.url),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not submit your verification.");
        if (body.reapplyAt) {
          setData((current) => ({ ...current, reapplyAt: body.reapplyAt }));
        }
        return;
      }

      setData((current) => ({
        ...current,
        status: "pending",
        rejectionReason: null,
        reapplyAt: null,
        latest: {
          id: body.requestId ?? current.latest?.id ?? "pending",
          status: "pending",
          linkedinUrl: linkedin.trim(),
          portfolioLinks,
          workSampleUrls: samples.map((sample) => sample.url),
          rejectionReason: null,
          reviewedAt: null,
          createdAt: body.submittedAt ?? new Date().toISOString(),
        },
      }));
      setNotice("Submitted. An admin will review your profile.");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="flex justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="font-body text-sm text-red-500">{loadError}</p>
      </div>
    );
  }

  if (data.status === "approved") {
    return (
      <StatusCard
        tone="green"
        icon={<BadgeCheck strokeWidth={2.5} size={18} className="text-green-500" />}
        title="Your account is verified"
      >
        You have full access to post, message, join communities, and apply to jobs.
      </StatusCard>
    );
  }

  if (data.status === "pending") {
    return (
      <StatusCard
        tone="amber"
        icon={<Clock3 strokeWidth={2.5} size={18} className="text-amber-500" />}
        title="Verification under review"
      >
        You submitted your profile on {dateLabel(data.latest?.createdAt)}. An admin will review
        it soon. Your account stays read-only until then.
      </StatusCard>
    );
  }

  const reapplyBlocked =
    data.status === "rejected" &&
    data.reapplyAt != null &&
    new Date(data.reapplyAt) > new Date();

  if (reapplyBlocked) {
    return (
      <div className="flex flex-col gap-4">
        <StatusCard
          tone="red"
          icon={<XCircle strokeWidth={2.5} size={18} className="text-red-500" />}
          title="Verification not approved"
        >
          {data.rejectionReason ? <p>Reason: {data.rejectionReason}</p> : null}
          <p className="mt-1">
            You can reapply from <strong>{dateLabel(data.reapplyAt)}</strong>. We&apos;ll email
            you when the window opens.
          </p>
        </StatusCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {data.status === "rejected" ? (
        <StatusCard
          tone="red"
          icon={<XCircle strokeWidth={2.5} size={18} className="text-red-500" />}
          title="Your previous verification was not approved"
        >
          {data.rejectionReason ? <p>Reason: {data.rejectionReason}</p> : null}
          <p className="mt-1">Update your details below and submit again.</p>
        </StatusCard>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="font-body text-sm text-red-500">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3">
          <p className="font-body text-sm text-green-500">{notice}</p>
        </div>
      ) : null}

      {/* Email verification */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Verify your account email *
        </h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          We&apos;ll send a six-digit code to the email you signed up with.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <input
            type="email"
            value={data.email}
            readOnly
            className="field w-full cursor-not-allowed opacity-70"
            aria-label="Account email (read-only)"
          />

          {emailVerifiedAt ? (
            <p className="flex items-center gap-1.5 font-body text-xs text-green-500">
              <CheckCircle2 strokeWidth={2.5} size={14} />
              Email verified
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={sendingCode || cooldown > 0}
                  className="rounded-md border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingCode
                    ? "Sending…"
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Send code"}
                </button>
                <span className="font-body text-[11px] text-foreground-subtle">
                  The email is fixed to your account.
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  className="field w-40 tracking-[0.35em]"
                  aria-label="Six-digit verification code"
                />
                <button
                  type="button"
                  onClick={() => void confirmCode()}
                  disabled={confirmingCode || code.length !== 6}
                  className="rounded-md bg-foreground px-4 py-2 font-body text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {confirmingCode ? "Checking…" : "Verify email"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* LinkedIn */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-semibold text-foreground">
            LinkedIn profile *
          </span>
          <span className="font-body text-xs text-foreground-muted">
            Use the profile you want us to review.
          </span>
          <input
            value={linkedin}
            onChange={(event) => setLinkedin(event.target.value)}
            placeholder="https://www.linkedin.com/in/yourprofile"
            type="url"
            className="field mt-1 w-full"
            autoComplete="url"
          />
        </label>
      </section>

      {/* Portfolio */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Design portfolio links *
        </h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Add 1–2 links to your best work. Google Docs and Notion pages are fine.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={portfolio1}
            onChange={(event) => setPortfolio1(event.target.value)}
            placeholder="https://yourportfolio.com"
            type="url"
            className="field w-full"
            aria-label="Portfolio link 1"
          />
          {showSecondPortfolio ? (
            <div className="flex items-center gap-2">
              <input
                value={portfolio2}
                onChange={(event) => setPortfolio2(event.target.value)}
                placeholder="Optional second link"
                type="url"
                className="field w-auto min-w-0 flex-1"
                aria-label="Portfolio link 2"
              />
              <button
                type="button"
                onClick={() => {
                  setPortfolio2("");
                  setShowSecondPortfolio(false);
                }}
                className="shrink-0 font-body text-xs text-foreground-subtle transition-colors hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSecondPortfolio(true)}
              className="self-start font-body text-xs font-medium text-accent transition-colors hover:text-accent-hover"
            >
              + Add another link
            </button>
          )}
        </div>
      </section>

      {/* Work samples */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Upload work samples
        </h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Optional but recommended. Add up to 3 recent UI/UX, web, mobile, or SaaS designs.
          Only submit work that is yours.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {samples.map((sample) => (
            <div
              key={sample.key || sample.url}
              className="group relative h-24 w-32 overflow-hidden rounded-lg border border-border bg-background"
            >
              <img src={sample.url} alt="Work sample" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => void removeSample(sample)}
                aria-label="Remove work sample"
                className="absolute right-1 top-1 rounded-md bg-background/90 px-1.5 py-0.5 font-body text-[10px] text-foreground shadow-sm"
              >
                Remove
              </button>
            </div>
          ))}

          {samples.length < 3 ? (
            <label className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-background text-center transition-colors hover:bg-surface-raised">
              <span className="font-body text-[11px] font-medium text-foreground">
                {uploading ? "Uploading…" : "Add images"}
              </span>
              <span className="font-body text-[10px] text-foreground-subtle">JPEG, PNG, WebP</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading}
                onChange={(event) => {
                  void uploadFiles(event.target.files);
                  event.target.value = "";
                }}
                className="sr-only"
              />
            </label>
          ) : null}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-[11px] text-foreground-subtle">
          Submitting sends your profile to an admin for review.
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || uploading}
          className="rounded-md bg-accent px-5 py-2 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit for review"}
        </button>
      </div>
    </div>
  );
}
