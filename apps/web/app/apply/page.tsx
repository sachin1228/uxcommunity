"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";

type Step = "form" | "success";

const initialForm = {
  name: "",
  email: "",
  linkedin_url: "",
  portfolio_url: "",
};

export default function ApplyPage() {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: [] }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.issues) {
          setFieldErrors(data.issues);
        } else {
          setError(data.error ?? "Something went wrong. Please try again.");
        }
        return;
      }

      setStep("success");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "rounded-md border border-border bg-background px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

  const fieldError = (key: string) =>
    fieldErrors[key]?.length ? (
      <p className="mt-1 font-body text-xs text-red-500">{fieldErrors[key][0]}</p>
    ) : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="pointer-events-none fixed inset-0 grid-dots opacity-40" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        {/* Back link */}
        <Link
          href="/login"
          className="mb-6 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to login
        </Link>

        {/* Brand */}
        <p className="mb-1 font-display text-xl font-semibold text-foreground">
          {APP_NAME}
          <span className="text-accent mx-1">/</span>
        </p>

        {/* Card */}
        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {step === "success" ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <span className="text-2xl">🎉</span>
              </div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Application submitted!
              </h2>
              <p className="font-body text-sm text-foreground-muted leading-relaxed">
                Thanks for applying! We review every application manually and will reach out with an invitation if you're approved.
              </p>
              <Link
                href="/login"
                className="mt-2 rounded-md border border-border px-6 py-2.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold text-foreground">
                Apply to {APP_NAME}
              </h1>
              <p className="mt-1 font-body text-sm text-foreground-muted">
                Join a community of designers. We review every application manually — if approved, you'll get an invite by email.
              </p>

              <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="font-body text-sm text-red-500">{error}</p>
                  </div>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    Full Name
                  </span>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Jordan Lee"
                    className={inputClass}
                    autoComplete="name"
                    required
                  />
                  {fieldError("name")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    Email Address
                  </span>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="you@studio.com"
                    className={inputClass}
                    autoComplete="email"
                    required
                  />
                  {fieldError("email")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    LinkedIn Profile URL
                  </span>
                  <input
                    type="url"
                    name="linkedin_url"
                    value={form.linkedin_url}
                    onChange={handleChange}
                    placeholder="https://linkedin.com/in/yourprofile"
                    className={inputClass}
                    required
                  />
                  {fieldError("linkedin_url")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    Portfolio URL
                  </span>
                  <input
                    type="url"
                    name="portfolio_url"
                    value={form.portfolio_url}
                    onChange={handleChange}
                    placeholder="https://yourportfolio.com"
                    className={inputClass}
                    required
                  />
                  {fieldError("portfolio_url")}
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && <Spinner className="h-4 w-4 text-white" />}
                  {loading ? "Submitting…" : "Submit Application"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center font-body text-sm text-foreground-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
