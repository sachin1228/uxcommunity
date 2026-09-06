"use client";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";
import { Button } from "@/components/ui/shadcn/button";


import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";

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
      <BrandLogo
        className="fixed left-6 top-6 z-20"
        iconClassName="h-8 w-8"
        wordmarkClassName="hidden"
      />
      <div className="relative z-10 w-full max-w-sm">
        {/* Back link */}
        <Link
          href="/login"
          className="mb-6 ml-8 inline-flex items-center gap-1.5 font-body text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft strokeWidth={2.5} size={14} />
          Back to login
        </Link>

        {/* Card */}
        <div className="rounded-xl bg-card p-8 shadow-card">
          {step === "sent" ? (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                    <span className="font-mono text-sm text-primary" aria-hidden="true">@</span>
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground mb-1">
                  Request received
                </h2>
                <p className="font-body text-sm text-muted-foreground leading-relaxed">
                  If <span className="font-medium text-foreground">{email}</span> is
                  registered, a reset link will be sent shortly. It expires in 1 hour.
                </p>
              </div>
              <Link
                href="/login"
                className="mt-2 rounded-md border border-border px-6 py-2.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-popover"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold text-foreground">
                Reset your password
              </h1>
              <p className="mt-1 font-body text-sm text-muted-foreground">
                Enter your email and we'll send you a link to set a new password.
              </p>

              <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="font-body text-sm text-red-500">{error}</p>
                  </div>
                )}

                <Label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-foreground">
                    Email address
                  </span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="you@studio.com"
                    className="w-full"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </Label>

                <Button variant="default"
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && <Spinner className="h-4 w-4 text-white" />}
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center font-body text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-primary transition-colors hover:text-primary"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
