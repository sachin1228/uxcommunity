"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { compressImage } from "@/lib/compressImage";
import { SignupStep1 } from "./components/SignupStep1";
import { SignupStep2 } from "./components/SignupStep2";
import { SignupStep3 } from "./components/SignupStep3";
import { SignupStep4 } from "./components/SignupStep4";
import { SignupWelcome } from "./components/SignupWelcome";

// Re-exported so profile page can import it from here (backward compat)
export { INTEREST_EMOJIS } from "@/lib/interests";

interface MasterItem { id: string; name: string; image_url?: string | null }

interface TokenState {
  status: "loading" | "valid" | "invalid";
  error?: string;
  applicationId?: string;
  applicantEmail?: string;
}

type Step = 1 | 2 | 3 | 4 | "done";

type WelcomeStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
};

type WelcomeState =
  | { phase: "loading"; percent: number; steps: WelcomeStep[] }
  | { phase: "ready"; joinedCommunities: number }
  | { phase: "error"; message: string }
  | null;

/** Splits an existing full name (e.g. from an approved application) into first/last parts. */
function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first_name: trimmed, last_name: "" };
  return {
    first_name: trimmed.slice(0, space).trim(),
    last_name: trimmed.slice(space).trim(),
  };
}

/** Combines first/last name inputs into the single `name` the API stores. */
function joinNameParts(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  // When there is no token we go straight into direct-signup mode
  const directMode = !token;

  const [tokenState, setTokenState] = useState<TokenState>(() =>
    directMode
      ? { status: "valid" }          // no token → open direct signup immediately
      : { status: "loading" }
  );

  // Step 1
  const [step1, setStep1] = useState({
    first_name: "", last_name: "", email: "", password: "", confirm_password: "",
  });
  const [step1Loading,     setStep1Loading]     = useState(false);
  const [step1Error,       setStep1Error]       = useState<string | null>(null);
  const [step1FieldErrors, setStep1FieldErrors] = useState<Record<string, string[]>>({});

  // Step 2
  const [step, setStep] = useState<Step>(1);
  const [cities,          setCities]          = useState<MasterItem[]>([]);
  const [sectors,         setSectors]         = useState<MasterItem[]>([]);
  const [experienceLevels, setExperienceLevels] = useState<{ id: string; slug: string; label: string; image_url: string | null }[]>([]);
  const [step2, setStep2] = useState({
    city_id: "", sector_id: "", experience_level: "",
  });
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error,   setStep2Error]   = useState<string | null>(null);

  // Step 3 — Interests
  const [interestOptions,     setInterestOptions]     = useState<{ id: string; name: string; image_url?: string | null }[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [step3Loading, setStep3Loading] = useState(false);
  const [step3Error,   setStep3Error]   = useState<string | null>(null);

  // Step 4 — Optional profile picture
  const [uploadedBlob, setUploadedBlob] = useState<Blob | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [step4Loading, setStep4Loading] = useState(false);
  const [step4Error, setStep4Error] = useState<string | null>(null);

  // Signup-completion overlay. Progress is real: each step below only marks
  // itself done (and advances the percentage) after its server request — and
  // the database write behind it — has actually succeeded.
  const [welcome, setWelcome] = useState<WelcomeState>(null);

  function buildSteps(withPicture: boolean): WelcomeStep[] {
    const steps: WelcomeStep[] = [];
    if (withPicture) {
      steps.push({
        id: "picture",
        label: "Uploading your profile picture",
        status: "pending",
      });
    }
    steps.push({ id: "account", label: "Creating your account", status: "pending" });
    steps.push({ id: "communities", label: "Joining your communities", status: "pending" });
    return steps;
  }

  function percentOf(steps: WelcomeStep[]): number {
    if (!steps.length) return 0;
    const done = steps.filter((s) => s.status === "done").length;
    return Math.round((done / steps.length) * 100);
  }

  function updateWelcomeStep(id: string, status: WelcomeStep["status"]) {
    setWelcome((w) => {
      if (!w || w.phase !== "loading") return w;
      const steps = w.steps.map((s) => (s.id === id ? { ...s, status } : s));
      return { ...w, steps, percent: percentOf(steps) };
    });
  }

  async function stepErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const data = await res.json();
      if (data?.error) return String(data.error);
      if (data?.issues) return fallback;
    } catch {
      // fall through
    }
    return fallback;
  }

  // ── Validate token (skipped in direct-signup mode) ───────────────────────
  useEffect(() => {
    if (directMode) return;
    fetch(`/api/signup/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setTokenState({ status: "valid", applicationId: d.applicationId, applicantEmail: d.applicantEmail });
          const { first_name, last_name } = splitFullName(d.applicantName ?? "");
          setStep1((p) => ({ ...p, email: d.applicantEmail ?? "", first_name, last_name }));
          setStep(1);
        } else {
          setTokenState({ status: "invalid", error: d.error ?? "Invalid invitation link." });
        }
      })
      .catch(() => setTokenState({ status: "invalid", error: "Failed to validate invitation. Please try again." }));
  }, [token, directMode]);

  // ── Load dropdowns for step 2 ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 2) return;
    Promise.all([
      fetch("/api/data/cities")   .then((r) => r.json()).then((d) => setCities(d.cities ?? [])),
      fetch("/api/data/sectors")  .then((r) => r.json()).then((d) => setSectors(d.sectors ?? [])),
      fetch("/api/data/experience-levels").then((r) => r.json()).then((d) => setExperienceLevels(d.experience_levels ?? [])),
    ]).catch(() => {});
  }, [step]);

  // ── Load interests for step 3 ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    fetch("/api/data/interests")
      .then((r) => r.json())
      .then((d) => setInterestOptions(d.interests ?? []))
      .catch(() => {});
  }, [step]);

  // ── Step handlers ─────────────────────────────────────────────────────────

  // First/last name live in separate inputs but the API stores one combined `name`.
  function step1Identity() {
    return {
      name: joinNameParts(step1.first_name, step1.last_name),
      email: step1.email,
      password: step1.password,
      confirm_password: step1.confirm_password,
    };
  }

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setStep1Loading(true);
    setStep1Error(null);
    setStep1FieldErrors({});
    try {
      // Direct-signup mode uses a separate endpoint that doesn't require a token
      const endpoint = directMode ? "/api/signup/direct" : "/api/signup/complete";
      const issues: Record<string, string[]> = {};
      if (!step1.first_name.trim()) issues.first_name = ["Name is required."];
      if (!step1.last_name.trim())  issues.last_name  = ["Surname is required."];
      if (Object.keys(issues).length) {
        setStep1FieldErrors(issues);
        return;
      }
      const identity = step1Identity();
      const body = directMode ? identity : { ...identity, token };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.redirectToLogin) {
          setStep1Error(data.error ?? "Your account is already set up. Please log in.");
          return;
        }
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

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setStep2Loading(true);
    setStep2Error(null);
    if (!step2.city_id)          { setStep2Error("Please select a city.");                setStep2Loading(false); return; }
    if (!step2.sector_id)        { setStep2Error("Please select an industry sector.");    setStep2Loading(false); return; }
    if (!step2.experience_level) { setStep2Error("Please select your experience level."); setStep2Loading(false); return; }
    setStep3Error(null);
    setSelectedInterestIds([]);
    setStep(3);
    setStep2Loading(false);
  }

  async function handleStep3() {
    setStep3Loading(true);
    setStep3Error(null);
    setUploadedBlob(null);
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadPreviewUrl(null);
    setStep4Error(null);
    setStep(4);
    setStep3Loading(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStep4Error(null);
    try {
      const compressed = await compressImage(file);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadedBlob(compressed);
      setUploadPreviewUrl(URL.createObjectURL(compressed));
    } catch {
      setStep4Error("Failed to process image. Please try a different file.");
    }
  }

  async function handleStep4() {
    // Hand the user straight to the welcome overlay. The steps below run one by
    // one, and each one only ticks over once its real server work is done.
    const steps = buildSteps(Boolean(uploadedBlob));
    setWelcome({ phase: "loading", percent: 0, steps });
    setStep4Error(null);
    // Let the overlay paint its first frame before starting the first request.
    await new Promise((resolve) => setTimeout(resolve, 80));
    setStep4Loading(true);
    try {
      let avatarUrl: string | null = null;
      let joinedCommunities = 0;

      for (const step of steps) {
        updateWelcomeStep(step.id, "active");

        if (step.id === "picture") {
          const fd = new FormData();
          fd.append("file", uploadedBlob!, "profile-picture.jpg");
          const res = await fetch("/api/signup/picture", { method: "POST", body: fd });
          if (!res.ok) {
            throw new Error(await stepErrorMessage(res, "Uploading your profile picture failed."));
          }
          const data = await res.json().catch(() => null);
          avatarUrl = data?.avatar_url ?? null;
          if (!avatarUrl) throw new Error("Uploading your profile picture failed.");
        } else if (step.id === "account") {
          const payload = {
            identity: step1Identity(),
            profile: step2,
            interest_ids: selectedInterestIds,
            ...(token ? { token } : {}),
            ...(avatarUrl ? { avatar_url: avatarUrl, avatar_source: "upload" as const } : {}),
          };
          const res = await fetch("/api/signup/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error(await stepErrorMessage(res, "Creating your account failed."));
          }
        } else if (step.id === "communities") {
          const res = await fetch("/api/communities/auto-join", { method: "POST" });
          if (!res.ok) {
            throw new Error(await stepErrorMessage(res, "Joining your communities failed."));
          }
          const data = await res.json().catch(() => null);
          joinedCommunities = Array.isArray(data?.joined) ? data.joined.length : 0;
        }

        updateWelcomeStep(step.id, "done");
      }

      setWelcome({ phase: "ready", joinedCommunities });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to complete signup. Please try again.";
      setWelcome({ phase: "error", message });
    } finally {
      setStep4Loading(false);
    }
  }

  function goToDashboard() {
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <BrandLogo
        className="fixed left-5 top-5 z-20"
        iconClassName="h-6 w-6"
        wordmarkClassName="text-lg"
      />
      <div className="w-full max-w-md">

        {tokenState.status === "loading" && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        )}

        {tokenState.status === "invalid" && (
          <div className="rounded-xl bg-surface p-8 text-center shadow-card">
            <p className="font-display text-lg font-semibold text-foreground mb-2">Invalid link</p>
            <p className="font-body text-sm text-foreground-muted">{tokenState.error}</p>
          </div>
        )}

        {tokenState.status === "valid" && step === 1 && (
          <SignupStep1
            state={step1}
            onChange={(patch) => setStep1((p) => ({ ...p, ...patch }))}
            loading={step1Loading}
            error={step1Error}
            fieldErrors={step1FieldErrors}
            onSubmit={handleStep1}
          />
        )}

        {tokenState.status === "valid" && step === 2 && (
          <SignupStep2
            state={step2}
            onChange={(patch) => setStep2((p) => ({ ...p, ...patch }))}
            cities={cities}
            sectors={sectors}
            experienceLevels={experienceLevels}
            loading={step2Loading}
            error={step2Error}
            onSubmit={handleStep2}
          />
        )}

        {tokenState.status === "valid" && step === 3 && (
          <SignupStep3
            options={interestOptions}
            selected={selectedInterestIds}
            onChange={setSelectedInterestIds}
            loading={step3Loading}
            error={step3Error}
            onContinue={handleStep3}
          />
        )}

        {tokenState.status === "valid" && step === 4 && (
              <SignupStep4
                uploadPreviewUrl={uploadPreviewUrl}
                loading={step4Loading}
                error={step4Error}
                onFileSelect={handleFileSelect}
                onRemoveUpload={() => {
                  setUploadedBlob(null);
                  if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
                  setUploadPreviewUrl(null);
                }}
                onSave={handleStep4}
              />

        )}

        {step === "done" && (
          <div className="rounded-xl bg-surface p-8 text-center shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">
              You&apos;re in!
            </h2>
            <p className="font-body text-sm text-foreground-muted">Redirecting to your dashboard…</p>
          </div>
        )}

      </div>

      {welcome && (
        <SignupWelcome
          phase={welcome.phase}
          firstName={step1.first_name.trim()}
          joinedCommunities={welcome.phase === "ready" ? welcome.joinedCommunities : 0}
          errorMessage={welcome.phase === "error" ? welcome.message : null}
          percent={welcome.phase === "loading" ? welcome.percent : 0}
          steps={welcome.phase === "loading" ? welcome.steps : []}
          onGoToDashboard={goToDashboard}
          onRetry={() => void handleStep4()}
          onClose={() => setWelcome(null)}
        />
      )}
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="h-6 w-6" />
      </div>
    }>
      <SignupInner />
    </Suspense>
  );
}
