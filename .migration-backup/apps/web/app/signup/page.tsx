"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";

const EXPERIENCE_LEVELS = [
  { value: "student", label: "Student" },
  { value: "fresher", label: "Fresher (0–1 Years)" },
  { value: "junior", label: "Junior Designer (1–3 Years)" },
  { value: "mid_level", label: "Mid-Level Designer (3–5 Years)" },
  { value: "senior", label: "Senior Designer (5–8 Years)" },
  { value: "lead", label: "Lead Designer (8–12 Years)" },
  { value: "principal", label: "Principal Designer" },
  { value: "staff", label: "Staff Designer" },
  { value: "design_manager", label: "Design Manager" },
  { value: "head_of_design", label: "Head of Design" },
  { value: "director", label: "Director of Design" },
  { value: "vp", label: "VP of Design" },
  { value: "consultant", label: "Design Consultant" },
  { value: "freelancer", label: "Freelancer" },
] as const;

interface MasterItem {
  id: string;
  name: string;
}

interface TokenState {
  status: "loading" | "valid" | "invalid";
  error?: string;
  applicationId?: string;
  applicantEmail?: string;
}

type Step = 1 | 2 | "done";

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [tokenState, setTokenState] = useState<TokenState>({ status: "loading" });

  // Step 1 form
  const [step1, setStep1] = useState({ name: "", email: "", password: "", confirm_password: "" });
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step1FieldErrors, setStep1FieldErrors] = useState<Record<string, string[]>>({});

  // Step 2 form
  const [step, setStep] = useState<Step>(1);
  const [companies, setCompanies] = useState<MasterItem[]>([]);
  const [cities, setCities] = useState<MasterItem[]>([]);
  const [sectors, setSectors] = useState<MasterItem[]>([]);
  const [step2, setStep2] = useState({
    company_id: "",
    city_id: "",
    sector_id: "",
    experience_level: "",
  });
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setTokenState({ status: "invalid", error: "No invitation token found in the URL." });
      return;
    }
    fetch(`/api/signup/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setTokenState({
            status: "valid",
            applicationId: d.applicationId,
            applicantEmail: d.applicantEmail,
          });
          setStep1((prev) => ({ ...prev, email: d.applicantEmail ?? "" }));
        } else {
          setTokenState({ status: "invalid", error: d.error ?? "Invalid invitation link." });
        }
      })
      .catch(() =>
        setTokenState({ status: "invalid", error: "Failed to validate invitation. Please try again." })
      );
  }, [token]);

  // Load dropdowns when moving to step 2
  useEffect(() => {
    if (step !== 2) return;
    // Fetch public versions (active only)
    Promise.all([
      fetch("/api/data/companies")
        .then((r) => r.json())
        .then((d) => setCompanies(d.companies ?? [])),
      fetch("/api/data/cities")
        .then((r) => r.json())
        .then((d) => setCities(d.cities ?? [])),
      fetch("/api/data/sectors")
        .then((r) => r.json())
        .then((d) => setSectors(d.sectors ?? [])),
    ]).catch(() => {});
  }, [step]);

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setStep1Loading(true);
    setStep1Error(null);
    setStep1FieldErrors({});

    try {
      const res = await fetch("/api/signup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...step1, token }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.issues) setStep1FieldErrors(data.issues);
        else setStep1Error(data.error ?? "Failed to create account.");
        return;
      }
      setStep(2);
    } catch {
      setStep1Error("Network error. Please try again.");
    } finally {
      setStep1Loading(false);
    }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setStep2Loading(true);
    setStep2Error(null);

    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: step2.company_id || null,
          city_id: step2.city_id || null,
          sector_id: step2.sector_id,
          experience_level: step2.experience_level,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStep2Error(data.error ?? "Failed to save profile.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setStep2Error("Network error. Please try again.");
    } finally {
      setStep2Loading(false);
    }
  }

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

  const fieldError = (errors: Record<string, string[]>, key: string) =>
    errors[key]?.length ? (
      <p className="mt-1 font-body text-xs text-red-400">{errors[key][0]}</p>
    ) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-overlay px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}
            <span className="text-accent mx-1">/</span>
          </span>
        </div>

        {tokenState.status === "loading" && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6 text-overlay-muted" />
          </div>
        )}

        {tokenState.status === "invalid" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center">
            <p className="font-display text-lg font-semibold text-overlay-foreground mb-2">
              Invalid link
            </p>
            <p className="font-body text-sm text-overlay-muted">{tokenState.error}</p>
          </div>
        )}

        {tokenState.status === "valid" && step === 1 && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
            <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
              Create your account
            </h2>
            <p className="font-body text-sm text-overlay-muted mb-7">Step 1 of 2</p>

            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              {step1Error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-400">{step1Error}</p>
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Full Name</span>
                <input type="text" value={step1.name} onChange={(e) => setStep1((p) => ({ ...p, name: e.target.value }))} placeholder="Jordan Lee" className={inputClass} autoComplete="name" required />
                {fieldError(step1FieldErrors, "name")}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Email</span>
                <input type="email" value={step1.email} onChange={(e) => setStep1((p) => ({ ...p, email: e.target.value }))} placeholder="you@studio.com" className={inputClass} autoComplete="email" required />
                {fieldError(step1FieldErrors, "email")}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Password</span>
                <input type="password" value={step1.password} onChange={(e) => setStep1((p) => ({ ...p, password: e.target.value }))} placeholder="Min 8 chars, 1 uppercase, 1 number" className={inputClass} autoComplete="new-password" required />
                {fieldError(step1FieldErrors, "password")}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Confirm Password</span>
                <input type="password" value={step1.confirm_password} onChange={(e) => setStep1((p) => ({ ...p, confirm_password: e.target.value }))} placeholder="••••••••" className={inputClass} autoComplete="new-password" required />
                {fieldError(step1FieldErrors, "confirm_password")}
              </label>

              <button type="submit" disabled={step1Loading} className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
                {step1Loading && <Spinner className="h-4 w-4 text-white" />}
                {step1Loading ? "Creating account…" : "Continue →"}
              </button>
            </form>
          </div>
        )}

        {tokenState.status === "valid" && step === 2 && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
            <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
              Complete your profile
            </h2>
            <p className="font-body text-sm text-overlay-muted mb-7">Step 2 of 2</p>

            <form onSubmit={handleStep2} className="flex flex-col gap-4">
              {step2Error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-400">{step2Error}</p>
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Company <span className="text-overlay-muted">(optional)</span></span>
                <select value={step2.company_id} onChange={(e) => setStep2((p) => ({ ...p, company_id: e.target.value }))} className={inputClass}>
                  <option value="">Select a company</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">City <span className="text-overlay-muted">(optional)</span></span>
                <select value={step2.city_id} onChange={(e) => setStep2((p) => ({ ...p, city_id: e.target.value }))} className={inputClass}>
                  <option value="">Select a city</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Industry Sector <span className="text-red-400">*</span></span>
                <select value={step2.sector_id} onChange={(e) => setStep2((p) => ({ ...p, sector_id: e.target.value }))} className={inputClass} required>
                  <option value="">Select a sector</option>
                  {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-medium text-overlay-foreground">Experience Level <span className="text-red-400">*</span></span>
                <select value={step2.experience_level} onChange={(e) => setStep2((p) => ({ ...p, experience_level: e.target.value }))} className={inputClass} required>
                  <option value="">Select your level</option>
                  {EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>

              <button type="submit" disabled={step2Loading} className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
                {step2Loading && <Spinner className="h-4 w-4 text-white" />}
                {step2Loading ? "Saving profile…" : "Complete Setup →"}
              </button>
            </form>
          </div>
        )}

        {step === "done" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-2">
              You're in!
            </h2>
            <p className="font-body text-sm text-overlay-muted mb-6">
              Your account and profile are set up. Welcome to {APP_NAME}.
            </p>
            <a
              href="/"
              className="inline-block rounded-md bg-accent px-6 py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Go to {APP_NAME}
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-overlay">
        <Spinner className="h-6 w-6 text-overlay-muted" />
      </main>
    }>
      <SignupInner />
    </Suspense>
  );
}
