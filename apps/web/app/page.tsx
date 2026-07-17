import Link from "next/link";
import { Eye, Heart } from "lucide-react";
import { APP_NAME } from "@draft/shared";

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
  return (
    <main className="flex min-h-screen bg-background">

      {/* ── Brand / canvas panel (always dark) ──────────────────────── */}
      <section className="relative hidden w-[55%] flex-col justify-between overflow-hidden bg-overlay px-14 py-12 lg:flex">

        {/* Dot-grid texture */}
        <div className="pointer-events-none absolute inset-0 grid-dots" aria-hidden="true" />

        {/* Radial vignette over the grid */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 30% 50%, transparent 30%, rgba(22,20,19,0.7) 100%)",
          }}
          aria-hidden="true"
        />

        {/* Orange accent glow — bottom-left corner */}
        <div
          className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #FF5E1F 0%, transparent 70%)" }}
          aria-hidden="true"
        />

        {/* Logo */}
        <div className="relative z-10">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}
            <span className="text-accent">/</span>
          </span>
        </div>

        {/* Designer profile card */}
        <div className="relative z-10 flex flex-1 items-center">
          <div className="relative w-[300px] -rotate-3 rounded-xl border border-overlay-elevated bg-overlay-raised p-4 shadow-xl">
            <CornerBrackets variant="signal" />

            {/* Card interior grid */}
            <div
              className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden grid-cross opacity-40"
              style={{ "--grid-line-color": "rgba(255,255,255,0.06)" } as React.CSSProperties}
              aria-hidden="true"
            />

            {/* Preview image area with gradient + grid overlay */}
            <div className="relative h-32 w-full overflow-hidden rounded-md bg-gradient-to-br from-accent to-[#9B320C]">
              <div
                className="absolute inset-0 grid-lines opacity-25"
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

        {/* Tagline */}
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

      {/* ── Login panel (always dark) ────────────────────────────────── */}
      <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-overlay px-6 py-12 lg:w-[45%]">

        {/* Line grid texture */}
        <div className="pointer-events-none absolute inset-0 grid-lines" aria-hidden="true" />

        {/* Subtle centre glow so the form lifts off the grid */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 75% 70% at 50% 50%, rgba(30,27,25,0.55) 0%, transparent 100%)",
          }}
          aria-hidden="true"
        />

        {/* Mobile logo */}
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
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-overlay-muted">
            auth / login
          </p>

          {/* Card — dark surface */}
          <div className="relative overflow-hidden rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
            <CornerBrackets />

            {/* Very faint dot grid inside card */}
            <div
              className="pointer-events-none absolute inset-0 grid-dots opacity-50"
              style={{ "--grid-dot-color": "rgba(255,255,255,0.05)" } as React.CSSProperties}
              aria-hidden="true"
            />

            {/* Status badge */}
            <span className="absolute -top-3 right-6 z-10 flex items-center gap-1.5 rounded-full border border-overlay-elevated bg-overlay px-3 py-1 font-mono text-[10px] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              editing
            </span>

            <h2 className="relative font-display text-2xl font-semibold text-overlay-foreground">
              Welcome back
            </h2>
            <p className="relative mt-1 font-body text-sm text-overlay-muted">
              Log in to keep working on your portfolio.
            </p>

            <form className="relative mt-7 flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">
                  Email address
                </span>
                <input
                  type="email"
                  placeholder="you@studio.com"
                  className="rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Password
                  </span>
                  <Link
                    href="#"
                    className="font-body text-xs text-accent transition-colors hover:text-accent-hover"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>

              <button
                type="button"
                className="mt-1 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                Log in
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-overlay-elevated" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-overlay-muted">
                or continue with
              </span>
              <span className="h-px flex-1 bg-overlay-elevated" />
            </div>

            {/* Social auth */}
            <div className="relative flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-md border border-overlay-elevated bg-overlay py-2.5 font-body text-sm text-overlay-foreground transition-colors hover:bg-overlay-elevated"
              >
                Google
              </button>
              <button
                type="button"
                className="flex-1 rounded-md border border-overlay-elevated bg-overlay py-2.5 font-body text-sm text-overlay-foreground transition-colors hover:bg-overlay-elevated"
              >
                Apple
              </button>
            </div>
          </div>

          <p className="mt-6 text-center font-body text-sm text-overlay-muted">
            New to {APP_NAME}?{" "}
            <Link
              href="#"
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
