"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApplyLink, setShowApplyLink] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        setShowApplyLink(!!data.showApplyLink);
        // Dismiss the full-screen state so the inline error is visible.
        setLoading(false);
        return;
      }
      setShowApplyLink(false);

      // Leave the full-screen "Logging in" state up until the navigation
      // unmounts this page — no flash back to the form mid-redirect.
      if (data.redirect) {
        router.push(data.redirect);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      {loading && <BrandedLoadingScreen label="Logging in" />}

      <BrandLogo
        className="fixed left-6 top-6 z-20"
        iconClassName="h-8 w-8"
        wordmarkClassName="hidden"
      />
      <section className="w-full max-w-sm">
        <div className="p-8">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Log in to your account
          </h1>

          <form className="mt-7 flex flex-col gap-5" onSubmit={handleLogin}>
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="font-body text-sm text-red-500">{error}</p>
                {showApplyLink && (
                  <Link
                    href="/signup"
                    className="mt-1 inline-block font-body text-xs text-accent underline hover:text-accent-hover"
                  >
                    Create an account →
                  </Link>
                )}
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="font-body text-xs font-medium text-foreground">
                Email address
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="you@studio.com"
                className="rounded-md border border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                autoComplete="email"
                required
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-body text-xs font-medium text-foreground">
                  Password
                </span>
                <Link
                  href="/forgot-password"
                  className="font-body text-xs text-accent transition-colors hover:text-accent-hover"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="••••••••"
                  className="w-full rounded-md border border-border bg-surface px-3.5 py-2.5 pr-10 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-subtle transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff strokeWidth={2.5} size={16} /> : <Eye strokeWidth={2.5} size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner className="h-4 w-4 text-white" />}
              {loading ? "Logging in…" : "Log in"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
              or continue with
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center rounded-md border border-border bg-surface py-2.5 font-body text-sm text-foreground-subtle opacity-60"
          >
            Google{" "}
            <span className="font-mono text-[10px] tracking-wide">
              (coming soon)
            </span>
          </button>
        </div>

        <p className="mt-6 text-center font-body text-sm text-foreground-muted">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            Sign up
          </Link>
        </p>
      </section>
    </main>
  );
}
