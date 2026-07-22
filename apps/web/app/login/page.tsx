"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Heart } from "lucide-react";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";

// Force happy mouths + eyes so every avatar looks cheerful
const HAPPY_PARAMS =
  "mouth[]=smile&mouth[]=twinkle&mouth[]=tongue" +
  "&eyes[]=happy&eyes[]=wink&eyes[]=squint" +
  "&backgroundColor=transparent";

const AVATAR_SEEDS = [
  { seed: "Sunny",  delay: 0,    size: "h-20" },
  { seed: "Mila",   delay: 0.12, size: "h-24" },
  { seed: "Theo",   delay: 0.24, size: "h-28" },
  { seed: "Priya",  delay: 0.36, size: "h-24" },
  { seed: "Juno",   delay: 0.48, size: "h-20" },
];

function FloatingAvatars() {
  return (
    <div className="relative h-44 w-full overflow-hidden rounded-md bg-gradient-to-br from-accent to-[#00254d]">
      <style>{`
        @keyframes avatarRise {
          from { transform: translateY(115%); }
          to   { transform: translateY(0);    }
        }
        .avatar-rise {
          animation: avatarRise 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
      `}</style>
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-0.5 px-3">
        {AVATAR_SEEDS.map(({ seed, delay, size }) => (
          <img
            key={seed}
            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&${HAPPY_PARAMS}`}
            className={`avatar-rise ${size} w-auto flex-shrink-0`}
            style={{ animationDelay: `${delay}s` }}
            alt=""
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

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
        return;
      }
      setShowApplyLink(false);

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
      <section className="relative hidden w-[55%] flex-col justify-between overflow-hidden bg-surface px-14 py-12 lg:flex border-r border-border">

        <div className="pointer-events-none absolute inset-0 grid-dots" aria-hidden="true" />

        <div className="relative z-10">
          <span className="font-display text-xl font-semibold text-foreground">
            {APP_NAME}
            <span className="text-accent mx-1">/</span>
          </span>
        </div>

        <div className="relative z-10 flex flex-1 items-center">
          <div className="relative w-[300px] -rotate-3 rounded-xl border border-border p-4 shadow-md">
            <CornerBrackets variant="signal" />

            <div
              className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden opacity-30"
              aria-hidden="true"
            />

            <FloatingAvatars />

            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-body text-xs font-semibold text-accent">
                JL
              </div>
              <div>
                <p className="font-body text-sm font-medium text-foreground">
                  Jordan Lee
                </p>
                <p className="font-mono text-[11px] text-foreground-muted">
                  Product Designer
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-foreground-muted">
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
          <h1 className="font-display text-3xl font-semibold leading-tight text-foreground">
            Where designers connect, share, and grow.
          </h1>
          <p className="mt-3 font-body text-sm text-foreground-muted">
            Showcase your work, get meaningful feedback, join communities, and discover real opportunities — built for UI/UX, product, and visual designers.
          </p>
        </div>
      </section>

      {/* ── Login panel ──────────────────────────────────────────────── */}
      <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-6 py-12 lg:w-[45%]">

        <div className="pointer-events-none absolute inset-0 grid-dots opacity-40" aria-hidden="true" />

        <div className="relative z-10 mb-8 flex flex-col items-center gap-2 lg:hidden">
          <span className="font-display text-xl font-semibold text-foreground">
            {APP_NAME}
            <span className="text-accent">/</span>
          </span>
          <p className="font-body text-sm text-foreground-muted">
            For UI/UX, product &amp; social designers
          </p>
        </div>

        <div className="relative z-10 w-full max-w-sm">
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-8 shadow-sm">
            <CornerBrackets />

            <h2 className="relative font-display text-2xl font-semibold text-foreground">
              Welcome back
            </h2>
            <p className="relative mt-1 font-body text-sm text-foreground-muted">
              Log in to keep working on your portfolio.
            </p>

            <form className="relative mt-7 flex flex-col gap-5" onSubmit={handleLogin}>
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-500">{error}</p>
                  {showApplyLink && (
                    <Link
                      href="/apply"
                      className="mt-1 inline-block font-body text-xs text-accent underline hover:text-accent-hover"
                    >
                      Apply for access →
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
                  className="rounded-md border border-border bg-background px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
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
                    className="w-full rounded-md border border-border bg-background px-3.5 py-2.5 pr-10 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted transition-colors hover:text-foreground"
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
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">
                or continue with
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="relative flex">
              {/* L-1: Google OAuth not yet implemented — disabled to avoid misleading users */}
              <button
                type="button"
                disabled
                className="flex-1 rounded-md border border-border bg-background py-2.5 font-body text-sm text-foreground-muted cursor-not-allowed opacity-50"
              >
                Google{" "}
                <span className="font-mono text-[10px] tracking-wide">
                  (coming soon)
                </span>
              </button>
            </div>
          </div>

          <p className="mt-6 text-center font-body text-sm text-foreground-muted">
            New to {APP_NAME}?{" "}
            <Link
              href="/apply"
              className="font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Create an account
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
