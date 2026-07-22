"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";
import { compressImage } from "@/lib/compressImage";
import { getAvatarSourceOptions, getAvatarTabLabel } from "@/lib/avatar";
import type { AvatarOption, AvatarSource } from "@/lib/avatar";
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
  resumeStep?: 2 | 3 | 4;
}

type Step = 1 | 2 | 3 | 4 | "done";

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [tokenState, setTokenState] = useState<TokenState>(() =>
    token
      ? { status: "loading" }
      : { status: "invalid", error: "No invitation token found in the URL." }
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

  // Step 4 — Avatar
  const [activeAvatarTab,   setActiveAvatarTab]   = useState<AvatarSource>("dicebear");
  const [selectedAvatar,    setSelectedAvatar]    = useState<AvatarOption | null>(null);
  const [uploadedBlob,      setUploadedBlob]      = useState<Blob | null>(null);
  const [uploadPreviewUrl,  setUploadPreviewUrl]  = useState<string | null>(null);
  const [step4Loading, setStep4Loading] = useState(false);
  const [step4Error,   setStep4Error]   = useState<string | null>(null);

  const avatarSourceOptions = useMemo(
    () => getAvatarSourceOptions(step1.name),
    [step1.name]
  );
  const avatarTabs = (["dicebear", "boring-avatars", "robohash", "avataaars", "multiavatar"] as AvatarSource[]).map(
    (key) => ({
      key,
      label: getAvatarTabLabel(key),
      count: (avatarSourceOptions[key as keyof typeof avatarSourceOptions] as AvatarOption[]).length,
    })
  );
  const visibleAvatarOptions = avatarSourceOptions[activeAvatarTab as keyof typeof avatarSourceOptions] as AvatarOption[];

  // ── Validate token ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`/api/signup/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setTokenState({ status: "valid", applicationId: d.applicationId, applicantEmail: d.applicantEmail, resumeStep: d.resumeStep });
          setStep1((p) => ({ ...p, email: d.applicantEmail ?? "", name: d.applicantName ?? "" }));
          if (d.resumeStep === 2 || d.resumeStep === 3 || d.resumeStep === 4) {
            setStep(d.resumeStep as 2 | 3 | 4);
          }
        } else {
          setTokenState({ status: "invalid", error: d.error ?? "Invalid invitation link." });
        }
      })
      .catch(() => setTokenState({ status: "invalid", error: "Failed to validate invitation. Please try again." }));
  }, [token]);

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
      const res = await fetch("/api/signup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...step1, token }),
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
      if (data.resumed && data.resumeStep) {
        setStep(data.resumeStep as 2 | 3 | 4);
      } else {
        setStep(2);
      }
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
    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(step2),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setStep1Error("Your session expired. Please re-enter your password to continue.");
          setStep(1);
          return;
        }
        setStep2Error(data.error ?? "Failed to save profile.");
        return;
      }
      setStep3Error(null);
      setSelectedInterestIds([]);
      setStep(3);
    } catch {
      setStep2Error("Network error. Please try again.");
    } finally {
      setStep2Loading(false);
    }
  }

  async function handleStep3() {
    setStep3Loading(true);
    setStep3Error(null);
    try {
      const res = await fetch("/api/signup/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interest_ids: selectedInterestIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setStep1Error("Your session expired. Please re-enter your password to continue.");
          setStep(1);
          return;
        }
        setStep3Error(data.error ?? "Failed to save interests.");
        return;
      }
      const options = getAvatarSourceOptions(step1.name);
      setActiveAvatarTab("dicebear");
      setSelectedAvatar(options.dicebear[0] ?? options.all[0] ?? null);
      setUploadedBlob(null);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(null);
      setStep4Error(null);
      setStep(4);
    } catch {
      setStep3Error("Network error. Please try again.");
    } finally {
      setStep3Loading(false);
    }
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
      setSelectedAvatar(null);
    } catch {
      setStep4Error("Failed to process image. Please try a different file.");
    }
  }

  async function handleStep4() {
    if (!uploadedBlob && !selectedAvatar) {
      setStep4Error("Please choose an avatar or upload a photo.");
      return;
    }
    setStep4Loading(true);
    setStep4Error(null);
    try {
      if (uploadedBlob) {
        const fd = new FormData();
        fd.append("file", uploadedBlob, "avatar.jpg");
        const res  = await fetch("/api/signup/avatar", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401) { setStep1Error("Your session expired. Please re-enter your password to continue."); setStep(1); return; }
          setStep4Error(data.error ?? "Upload failed.");
          return;
        }
      } else if (selectedAvatar) {
        const res  = await fetch("/api/signup/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar_url: selectedAvatar.dbUrl, avatar_source: selectedAvatar.source }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401) { setStep1Error("Your session expired. Please re-enter your password to continue."); setStep(1); return; }
          setStep4Error(data.error ?? "Failed to save avatar.");
          return;
        }
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

  function handlePickAvatar(opt: AvatarOption) {
    setSelectedAvatar(opt);
    setUploadedBlob(null);
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadPreviewUrl(null);
    setStep4Error(null);
  }

  function handleRemoveUpload() {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadPreviewUrl(null);
    setUploadedBlob(null);
    const options = getAvatarSourceOptions(step1.name);
    setSelectedAvatar(options[activeAvatarTab as keyof typeof options][0] as AvatarOption ?? options.all[0] ?? null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-overlay px-4 py-12">
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="font-display text-xl font-semibold text-overlay-foreground">
            {APP_NAME}<span className="text-accent mx-1">/</span>
          </span>
        </div>

        {tokenState.status === "loading" && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6 text-overlay-muted" />
          </div>
        )}

        {tokenState.status === "invalid" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center">
            <p className="font-display text-lg font-semibold text-overlay-foreground mb-2">Invalid link</p>
            <p className="font-body text-sm text-overlay-muted">{tokenState.error}</p>
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
            avatarTabs={avatarTabs}
            activeTab={activeAvatarTab}
            onTabChange={setActiveAvatarTab}
            visibleOptions={visibleAvatarOptions}
            selectedAvatar={selectedAvatar}
            uploadPreviewUrl={uploadPreviewUrl}
            loading={step4Loading}
            error={step4Error}
            onPickAvatar={handlePickAvatar}
            onFileSelect={handleFileSelect}
            onRemoveUpload={handleRemoveUpload}
            onSave={handleStep4}
          />
        )}

        {step === "done" && (
          <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-overlay-foreground mb-2">
              You&apos;re in!
            </h2>
            <p className="font-body text-sm text-overlay-muted">Redirecting to your dashboard…</p>
          </div>
        )}

      </div>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-overlay">
        <Spinner className="h-6 w-6 text-overlay-muted" />
      </div>
    }>
      <SignupInner />
    </Suspense>
  );
}
