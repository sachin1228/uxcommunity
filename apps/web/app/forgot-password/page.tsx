"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";

type Step = "form" | "sent";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setStep("sent");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="pointer-events-none fixed inset-0 grid-dots opacity-40" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-sm">
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
          {step === "sent" ? (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <span className="text-2xl">✉️</span>
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground mb-1">
                  Request received
                </h2>
                <p className="font-body text-sm text-foreground-muted leading-relaxed">
                  If <span className="font-medium text-foreground">{email}</span> is
                  registered, a reset link will be sent shortly. It expires in 1 hour.
                </p>
              </div>
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
                Reset your password
              </h1>
              <p className="mt-1 font-body text-sm text-foreground-muted">
                Enter your email and we'll send you a link to set a new password.
              </p>

              <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="font-body text-sm text-red-500">{error}</p>
                  </div>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    Email address
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="you@studio.com"
                    className="rounded-md border border-border bg-background px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && <Spinner className="h-4 w-4 text-white" />}
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center font-body text-sm text-foreground-muted">
          Remember your password?{" "}
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
