"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Heart } from "lucide-react";
import { APP_NAME } from "@draft/shared";
import { ApplicationModal } from "@/components/apply/ApplicationModal";
import { ForgotPasswordModal } from "@/components/auth/ForgotPasswordModal";
import { Spinner } from "@/components/ui/Spinner";

function CornerBrackets({
  variant = "accent",
}: {
  variant?: "accent" | "signal";
}) {
  const color =
    variant === "signal" ? "border-signal" : "border-accent";
  return (
    <>
      <span
        className={`pointer-events-none absolute -left-2 -top-2 h-4 w-4 border-l-2 border-t-2 ${color}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute -right-2 -top-2 h-4 w-4 border-r-2 border-t-2 ${color}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute -bottom-2 -left-2 h-4 w-4 border-b-2 border-l-2 ${color}`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute -bottom-2 -right-2 h-4 w-4 border-b-2 border-r-2 ${color}`}
        aria-hidden="true"
      />
    </>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

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
    setShowApplyLink(false);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        if (data.showApplyLink) setShowApplyLink(true);
        return;
      }

      if (data.redirect) {
        router.push(data.redirect);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-background">

      {/* ── Brand / canvas panel ─────────────────────────────────────── */}
      <section className="relative hidden w-[55%] flex-col justify-between overflow-hidden bg-overlay px-14 py-12 lg:flex">

        <div className="pointer-events-none absolute inset-0 grid-dots" aria-hidden="true" />

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 30% 50%, transparent 30%, rgba(22,20,19,0.7) 100%)",
          }}
          aria-hidden="true"
        />

        <div className="relative z-10">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}
            <span className="text-accent mx-1">/</span>
          </span>
        </div>

        <div className="relative z-10 flex flex-1 items-center">
          <div className="relative w-[300px] -rotate-3 rounded-xl border border-overlay-elevated bg-overlay-raised p-4 shadow-xl">
            <CornerBrackets variant="signal" />

            <div
              className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden grid-cross opacity-40"
              style={{ "--grid-line-color": "rgba(255,255,255,0.06)" } as React.CSSProperties}
              aria-hidden="true"
            />

            <div className="relative h-32 w-full overflow-hidden rounded-md bg-gradient-to-br from-accent to-[#9B320C]">
              <div
                className="absolute inset-0 opacity-25"
                style={{ "--grid-line-color": "rgba(255,255,255,0.15)" } as React.CSSProperties}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-body text-xs font-semibold text-accent">
                JL
              </div>
              <div>
                <p className="font-body text-sm font-medium text-overlay-foreground">
                  Jordan Lee
                </p>
                <p className="font-mono text-[11px] text-overlay-muted">
                  Product Designer
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-overlay-muted">
              <span className="flex items-center gap-1">
                <Eye size={12} /> 2.4k
              </span>
              <span className="flex items-center gap-1">
                <Heart size={12} /> 312
              </span>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-sm">
          <h1 className="font-display text-3xl font-semibold leading-tight text-overlay-foreground">
            Where design work finds its audience.
          </h1>
          <p className="mt-3 font-body text-sm text-overlay-muted">
            Portfolios, feedback, and real opportunities — for UI/UX,
            product, and social media designers.
          </p>
        </div>
      </section>

      {/* ── Login panel ──────────────────────────────────────────────── */}
      <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-overlay px-6 py-12 lg:w-[45%]">

        <div className="pointer-events-none absolute inset-0" aria-hidden="true" />

        <div className="relative z-10 mb-8 flex flex-col items-center gap-2 lg:hidden">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}
            <span className="text-accent">/</span>
          </span>
          <p className="font-body text-sm text-overlay-muted">
            For UI/UX, product &amp; social designers
          </p>
        </div>

        <div className="relative z-10 w-full max-w-sm">
          <div className="relative overflow-hidden rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
            <CornerBrackets />

            <h2 className="relative font-display text-2xl font-semibold text-overlay-foreground">
              Welcome back
            </h2>
            <p className="relative mt-1 font-body text-sm text-overlay-muted">
              Log in to keep working on your portfolio.
            </p>

            <form className="relative mt-7 flex flex-col gap-5" onSubmit={handleLogin}>
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-400">{error}</p>
                  {showApplyLink && (
                    <button
                      type="button"
                      onClick={() => setModalOpen(true)}
                      className="mt-1 font-body text-xs text-accent underline hover:text-accent-hover"
                    >
                      Apply for access →
                    </button>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">
                  Email address
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="you@studio.com"
                  className="rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  autoComplete="email"
                  required
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Password
                  </span>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="font-body text-xs text-accent transition-colors hover:text-accent-hover"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder="••••••••"
                    className="w-full rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 pr-10 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-overlay-muted transition-colors hover:text-overlay-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && <Spinner className="h-4 w-4 text-white" />}
                {loading ? "Logging in…" : "Log in"}
              </button>
            </form>

            <div className="relative my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-overlay-elevated" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-overlay-muted">
                or continue with
              </span>
              <span className="h-px flex-1 bg-overlay-elevated" />
            </div>

            <div className="relative flex">
              <button
                type="button"
                className="flex-1 rounded-md border border-overlay-elevated bg-overlay py-2.5 font-body text-sm text-overlay-foreground transition-colors hover:bg-overlay-elevated"
              >
                Google
              </button>
            </div>
          </div>

          <p className="mt-6 text-center font-body text-sm text-overlay-muted">
            New to {APP_NAME}?{" "}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Create an account
            </button>
          </p>
        </div>
      </section>

      <ApplicationModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </main>
  );
}
