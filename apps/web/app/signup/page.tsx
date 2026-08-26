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
    name: "", email: "", password: "", confirm_password: "",
  });
  const [step1Loading,     setStep1Loading]     = useState(false);
  const [step1Error,       setStep1Error]       = useState<string | null>(null);
  const [step1FieldErrors, setStep1FieldErrors] = useState<Record<string, string[]>>({});

  // Step 2
  const [step, setStep] = useState<Step>(1);
  const [companies,       setCompanies]       = useState<MasterItem[]>([]);
  const [cities,          setCities]          = useState<MasterItem[]>([]);
  const [sectors,         setSectors]         = useState<MasterItem[]>([]);
  const [experienceLevels, setExperienceLevels] = useState<{ id: string; slug: string; label: string; image_url: string | null }[]>([]);
  const [step2, setStep2] = useState({
    company_id: "", city_id: "", sector_id: "", experience_level: "",
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

  // ── Validate token (skipped in direct-signup mode) ───────────────────────
  useEffect(() => {
    if (directMode) return;
    fetch(`/api/signup/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setTokenState({ status: "valid", applicationId: d.applicationId, applicantEmail: d.applicantEmail });
          setStep1((p) => ({ ...p, email: d.applicantEmail ?? "", name: d.applicantName ?? "" }));
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
      fetch("/api/data/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])),
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

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setStep1Loading(true);
    setStep1Error(null);
    setStep1FieldErrors({});
    try {
      // Direct-signup mode uses a separate endpoint that doesn't require a token
      const endpoint = directMode ? "/api/signup/direct" : "/api/signup/complete";
      const body = directMode ? step1 : { ...step1, token };
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

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setStep2Loading(true);
    setStep2Error(null);
    if (!step2.company_id)       { setStep2Error("Please select a company.");             setStep2Loading(false); return; }
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
    setStep4Loading(true);
    setStep4Error(null);
    try {
      const payload = {
        identity: step1,
        profile: step2,
        interest_ids: selectedInterestIds,
        ...(token ? { token } : {}),
        ...(uploadedBlob ? { avatar_source: "upload" as const } : {}),
      };

      let res: Response;
      if (uploadedBlob) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify(payload));
        fd.append("file", uploadedBlob, "profile-picture.jpg");
        res = await fetch("/api/signup/avatar", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/signup/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setStep4Error(data.error ?? "Failed to complete signup.");
        return;
      }
      try {
        await Promise.race([
          fetch("/api/communities/auto-join", { method: "POST" }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
        ]);
      } catch { /* Non-fatal */ }
      router.push("/dashboard");
    } catch {
      setStep4Error("Network error. Please try again.");
    } finally {
      setStep4Loading(false);
    }
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
            companies={companies}
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
