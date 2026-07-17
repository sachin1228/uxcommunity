"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";

type PageState = "loading" | "form" | "success" | "invalid";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Validate that a token was provided (full server-side validation happens on submit)
  useEffect(() => {
    if (!token) {
      setPageState("invalid");
    } else {
      setPageState("form");
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/auth/reset-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.issues) {
          setFieldErrors(data.issues);
        } else {
          setError(data.error ?? "Failed to reset password. Please try again.");
          // If token is invalid/expired, switch to invalid state
          if (res.status === 400 || res.status === 410) {
            setPageState("invalid");
          }
        }
        return;
      }

      setPageState("success");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

  const fieldError = (key: string) =>
    fieldErrors[key]?.length ? (
      <p className="mt-1 font-body text-xs text-red-400">{fieldErrors[key][0]}</p>
    ) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-overlay px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}
            <span className="text-accent mx-1">/</span>
          </span>
        </div>

        {pageState === "loading" && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6 text-overlay-muted" />
          </div>
        )}

        {pageState === "invalid" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center">
            <p className="font-display text-lg font-semibold text-overlay-foreground mb-2">
              Link invalid or expired
            </p>
            <p className="font-body text-sm text-overlay-muted mb-6">
              {error ?? "This password reset link is invalid or has already been used. Reset links expire after 1 hour."}
            </p>
            <a
              href="/"
              className="inline-block font-body text-sm text-accent hover:text-accent-hover transition-colors"
            >
              ← Back to login
            </a>
          </div>
        )}

        {pageState === "form" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
            <h1 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
              Set new password
            </h1>
            <p className="font-body text-sm text-overlay-muted mb-7">
              Choose a strong password for your account.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-400">{error}</p>
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">
                  New password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                    setFieldErrors((p) => ({ ...p, password: [] }));
                  }}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  className={inputClass}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
                {fieldError("password")}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">
                  Confirm new password
                </span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError(null);
                    setFieldErrors((p) => ({ ...p, confirm_password: [] }));
                  }}
                  placeholder="••••••••"
                  className={inputClass}
                  autoComplete="new-password"
                  required
                />
                {fieldError("confirm_password")}
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && <Spinner className="h-4 w-4 text-white" />}
                {loading ? "Updating password…" : "Update password"}
              </button>
            </form>
          </div>
        )}

        {pageState === "success" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-overlay-foreground mb-2">
              Password updated
            </h2>
            <p className="font-body text-sm text-overlay-muted mb-6">
              Your password has been changed. You can now log in with your new password.
            </p>
            <a
              href="/"
              className="inline-block rounded-md bg-accent px-6 py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Go to login
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-overlay">
          <Spinner className="h-6 w-6 text-overlay-muted" />
        </main>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
