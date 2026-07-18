"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import Avatar from "boring-avatars";

// ─── Constants ────────────────────────────────────────────────

const EXPERIENCE_LEVELS = [
  { value: "student",        label: "Student" },
  { value: "fresher",        label: "Fresher (0–1 Years)" },
  { value: "junior",         label: "Junior Designer (1–3 Years)" },
  { value: "mid_level",      label: "Mid-Level Designer (3–5 Years)" },
  { value: "senior",         label: "Senior Designer (5–8 Years)" },
  { value: "lead",           label: "Lead Designer (8–12 Years)" },
  { value: "principal",      label: "Principal Designer" },
  { value: "staff",          label: "Staff Designer" },
  { value: "design_manager", label: "Design Manager" },
  { value: "head_of_design", label: "Head of Design" },
  { value: "director",       label: "Director of Design" },
  { value: "vp",             label: "VP of Design" },
  { value: "consultant",     label: "Design Consultant" },
  { value: "freelancer",     label: "Freelancer" },
] as const;

// All DiceBear v9 sprite packs (verified working)
const ALL_DICEBEAR_STYLES: { style: string; label: string }[] = [
  { style: "adventurer",         label: "Adventurer" },
  { style: "adventurer-neutral", label: "Adventurer Neutral" },
  { style: "avataaars",          label: "Avataaars" },
  { style: "avataaars-neutral",  label: "Avataaars Neutral" },
  { style: "big-ears",           label: "Big Ears" },
  { style: "big-ears-neutral",   label: "Big Ears Neutral" },
  { style: "big-smile",          label: "Big Smile" },
  { style: "bottts",             label: "Bottts" },
  { style: "bottts-neutral",     label: "Bottts Neutral" },
  { style: "croodles",           label: "Croodles" },
  { style: "croodles-neutral",   label: "Croodles Neutral" },
  { style: "dylan",              label: "Dylan" },
  { style: "fun-emoji",          label: "Fun Emoji" },
  { style: "glass",              label: "Glass" },
  { style: "identicon",          label: "Identicon" },
  { style: "lorelei",            label: "Lorelei" },
  { style: "lorelei-neutral",    label: "Lorelei Neutral" },
  { style: "micah",              label: "Micah" },
  { style: "miniavs",            label: "Miniavs" },
  { style: "notionists",         label: "Notionists" },
  { style: "notionists-neutral", label: "Notionists Neutral" },
  { style: "open-peeps",         label: "Open Peeps" },
  { style: "personas",           label: "Personas" },
  { style: "pixel-art",          label: "Pixel Art" },
  { style: "pixel-art-neutral",  label: "Pixel Art Neutral" },
  { style: "rings",              label: "Rings" },
  { style: "shapes",             label: "Shapes" },
  { style: "thumbs",             label: "Thumbs" },
];

// All Boring Avatars variants (rendered inline via npm — no CDN)
const ALL_BORING_STYLES: { style: string; label: string }[] = [
  { style: "marble",    label: "Marble" },
  { style: "beam",      label: "Beam" },
  { style: "pixel",     label: "Pixel" },
  { style: "sunset",    label: "Sunset" },
  { style: "ring",      label: "Ring" },
  { style: "bauhaus",   label: "Bauhaus" },
  { style: "triangles", label: "Triangles" },
];

// Robohash sets (URL-based)
const ALL_ROBOHASH_SETS: { set: string; label: string }[] = [
  { set: "set1", label: "Robots" },
  { set: "set2", label: "Monsters" },
  { set: "set3", label: "Robot Heads" },
  { set: "set4", label: "Kittens" },
];

// ─── Types ────────────────────────────────────────────────────

type AvatarSource = "dicebear" | "boring-avatars" | "robohash";

interface AvatarOption {
  id: string;
  source: AvatarSource;
  style: string;
  label: string;
  /** URL to store in the DB (and to display for non-boring-avatars). */
  dbUrl: string;
  /** User's name — seed for boring-avatars rendering. */
  seed: string;
}

interface MasterItem { id: string; name: string }

interface TokenState {
  status: "loading" | "valid" | "invalid";
  error?: string;
  applicationId?: string;
  applicantEmail?: string;
  /** When the server detects an incomplete signup, jump straight to this step. */
  resumeStep?: 2 | 3;
}

type Step = 1 | 2 | 3 | "done";

type AvatarTab = AvatarSource;

// ─── Helpers ──────────────────────────────────────────────────

function getAllAvatarOptions(name: string): AvatarOption[] {
  const baseName = name || "designer";
  const seedNames = Array.from({ length: 6 }, (_, index) =>
    index === 0 ? baseName : `${baseName} ${index + 1}`
  );

  const dicebear = ALL_DICEBEAR_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, index) => {
      const seed = encodeURIComponent(seedName);
      return {
        id: `dicebear-${style}-${index}`,
        source: "dicebear" as AvatarSource,
        style,
        label: index === 0 ? label : `${label} ${index + 1}`,
        dbUrl: `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`,
        seed: seedName,
      };
    })
  );
  const boring = ALL_BORING_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, index) => {
      const seed = encodeURIComponent(seedName);
      return {
        id: `boring-${style}-${index}`,
        source: "boring-avatars" as AvatarSource,
        style,
        label: index === 0 ? label : `${label} ${index + 1}`,
        dbUrl: `boring://${style}/${seed}`,
        seed: seedName,
      };
    })
  );
  const robohash = ALL_ROBOHASH_SETS.flatMap(({ set, label }) =>
    seedNames.map((seedName, index) => {
      const seed = encodeURIComponent(seedName);
      return {
        id: `robohash-${set}-${index}`,
        source: "robohash" as AvatarSource,
        style: set,
        label: index === 0 ? label : `${label} ${index + 1}`,
        dbUrl: `https://robohash.org/${seed}?set=${set}&size=200x200`,
        seed: seedName,
      };
    })
  );

  return [...dicebear, ...boring, ...robohash];
}

function getAvatarTabLabel(source: AvatarSource) {
  if (source === "dicebear") return "DiceBear";
  if (source === "boring-avatars") return "Boring Avatars";
  return "Robohash";
}

function getAvatarSourceOptions(name: string) {
  const all = getAllAvatarOptions(name);
  return {
    all,
    dicebear: all.filter((option) => option.source === "dicebear"),
    "boring-avatars": all.filter((option) => option.source === "boring-avatars"),
    robohash: all.filter((option) => option.source === "robohash"),
  };
}

/** Compress + center-crop a file to 300×300 JPEG via Canvas. */
async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const SIZE = 300;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      const min = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth  - min) / 2;
      const sy = (img.naturalHeight - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error("Compression failed")); },
        "image/jpeg", 0.78
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Failed to load image")); };
    img.src = objectUrl;
  });
}

// ─── Sub-components ───────────────────────────────────────────

/** Renders one avatar option — inline SVG for boring-avatars, <img> for others. */
function AvatarPreview({
  option,
  size = 56,
}: {
  option: AvatarOption;
  size?: number;
}) {
  if (option.source === "boring-avatars") {
    return (
      <span
        style={{
          width: size, height: size,
          display: "inline-flex", borderRadius: "50%", overflow: "hidden",
        }}
      >
        <Avatar size={size} name={option.seed} variant={option.style as "marble"} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={option.dbUrl}
      alt={option.label}
      width={size}
      height={size}
      className="rounded-full object-cover bg-overlay-elevated"
      loading="lazy"
    />
  );
}

// ─── Main component ───────────────────────────────────────────

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tokenState, setTokenState] = useState<TokenState>(() =>
    token
      ? { status: "loading" }
      : { status: "invalid", error: "No invitation token found in the URL." }
  );

  // Step 1
  const [step1, setStep1] = useState({ name: "", email: "", password: "", confirm_password: "" });
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error,   setStep1Error]   = useState<string | null>(null);
  const [step1FieldErrors, setStep1FieldErrors] = useState<Record<string, string[]>>({});

  // Step 2
  const [step, setStep] = useState<Step>(1);
  const [companies, setCompanies] = useState<MasterItem[]>([]);
  const [cities,    setCities]    = useState<MasterItem[]>([]);
  const [sectors,   setSectors]   = useState<MasterItem[]>([]);
  const [step2, setStep2] = useState({ company_id: "", city_id: "", sector_id: "", experience_level: "" });
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error,   setStep2Error]   = useState<string | null>(null);

  // Step 3
  const [activeAvatarTab, setActiveAvatarTab] = useState<AvatarTab>("dicebear");
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarOption | null>(null);
  const [uploadedBlob, setUploadedBlob] = useState<Blob | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [step3Loading, setStep3Loading] = useState(false);
  const [step3Error,   setStep3Error]   = useState<string | null>(null);

  const avatarSourceOptions = useMemo(() => getAvatarSourceOptions(step1.name), [step1.name]);
  const avatarTabs: { key: AvatarTab; label: string; count: number }[] = [
    { key: "dicebear", label: getAvatarTabLabel("dicebear"), count: avatarSourceOptions.dicebear.length },
    { key: "boring-avatars", label: getAvatarTabLabel("boring-avatars"), count: avatarSourceOptions["boring-avatars"].length },
    { key: "robohash", label: getAvatarTabLabel("robohash"), count: avatarSourceOptions.robohash.length },
  ];
  const visibleAvatarOptions = avatarSourceOptions[activeAvatarTab];

  // ── Validate token ─────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`/api/signup/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setTokenState({
            status: "valid",
            applicationId: d.applicationId,
            applicantEmail: d.applicantEmail,
            resumeStep: d.resumeStep,
          });
          setStep1((prev) => ({ ...prev, email: d.applicantEmail ?? "" }));
          // If the server detected an incomplete signup in progress, jump
          // straight to the correct step (session cookie still valid from step 1).
          if (d.resumeStep === 2 || d.resumeStep === 3) {
            setStep(d.resumeStep as 2 | 3);
          }
        } else {
          setTokenState({ status: "invalid", error: d.error ?? "Invalid invitation link." });
        }
      })
      .catch(() => setTokenState({ status: "invalid", error: "Failed to validate invitation. Please try again." }));
  }, [token]);

  // ── Load dropdowns for step 2 ──────────────────────────────
  useEffect(() => {
    if (step !== 2) return;
    Promise.all([
      fetch("/api/data/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])),
      fetch("/api/data/cities")   .then((r) => r.json()).then((d) => setCities(d.cities ?? [])),
      fetch("/api/data/sectors")  .then((r) => r.json()).then((d) => setSectors(d.sectors ?? [])),
    ]).catch(() => {});
  }, [step]);

  // ── Handlers ───────────────────────────────────────────────

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
    if (!step2.company_id)       { setStep2Error("Please select a company.");         setStep2Loading(false); return; }
    if (!step2.city_id)          { setStep2Error("Please select a city.");             setStep2Loading(false); return; }
    if (!step2.sector_id)        { setStep2Error("Please select an industry sector."); setStep2Loading(false); return; }
    if (!step2.experience_level) { setStep2Error("Please select your experience level."); setStep2Loading(false); return; }
    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(step2),
      });
      const data = await res.json();
      if (!res.ok) { setStep2Error(data.error ?? "Failed to save profile."); return; }
      const options = getAvatarSourceOptions(step1.name);
      setActiveAvatarTab("dicebear");
      setSelectedAvatar(options.dicebear[0] ?? options.all[0] ?? null);
      setUploadedBlob(null);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(null);
      setStep3Error(null);
      setStep(3);
    } catch {
      setStep2Error("Network error. Please try again.");
    } finally {
      setStep2Loading(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStep3Error(null);
    try {
      const compressed = await compressImage(file);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadedBlob(compressed);
      setUploadPreviewUrl(URL.createObjectURL(compressed));
      setSelectedAvatar(null);
    } catch {
      setStep3Error("Failed to process image. Please try a different file.");
    }
  }

  async function handleStep3() {
    // Require an avatar
    if (!uploadedBlob && !selectedAvatar) {
      setStep3Error("Please choose an avatar or upload a photo.");
      return;
    }
    setStep3Loading(true);
    setStep3Error(null);
    try {
      if (uploadedBlob) {
        const fd = new FormData();
        fd.append("file", uploadedBlob, "avatar.jpg");
        const res  = await fetch("/api/signup/avatar", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) { setStep3Error(data.error ?? "Upload failed."); return; }
      } else if (selectedAvatar) {
        const res  = await fetch("/api/signup/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar_url: selectedAvatar.dbUrl, avatar_source: selectedAvatar.source }),
        });
        const data = await res.json();
        if (!res.ok) { setStep3Error(data.error ?? "Failed to save avatar."); return; }
      }
      router.push("/dashboard");
    } catch {
      setStep3Error("Network error. Please try again.");
    } finally {
      setStep3Loading(false);
    }
  }

  function handlePickAvatar(opt: AvatarOption) {
    setSelectedAvatar(opt);
    setUploadedBlob(null);
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadPreviewUrl(null);
  }

  // ── Shared styles ──────────────────────────────────────────

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

  const fieldError = (errors: Record<string, string[]>, key: string) =>
    errors[key]?.length ? (
      <p className="mt-1 font-body text-xs text-red-400">{errors[key][0]}</p>
    ) : null;

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      <main className="flex min-h-screen items-center justify-center bg-overlay px-4 py-12">
        <div className="w-full max-w-md">

          {/* Logo */}
          <div className="mb-8 text-center">
            <span className="font-display text-xl font-semibold text-overlay-foreground">
              {APP_NAME}<span className="text-accent mx-1">/</span>
            </span>
          </div>

          {/* Loading */}
          {tokenState.status === "loading" && (
            <div className="flex justify-center py-16">
              <Spinner className="h-6 w-6 text-overlay-muted" />
            </div>
          )}

          {/* Invalid token */}
          {tokenState.status === "invalid" && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 text-center">
              <p className="font-display text-lg font-semibold text-overlay-foreground mb-2">Invalid link</p>
              <p className="font-body text-sm text-overlay-muted">{tokenState.error}</p>
            </div>
          )}

          {/* ── Step 1 ── */}
          {tokenState.status === "valid" && step === 1 && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
              <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
                Create your account
              </h2>
              <p className="font-body text-sm text-overlay-muted mb-7">Step 1 of 3</p>

              <form onSubmit={handleStep1} className="flex flex-col gap-4">
                {step1Error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="font-body text-sm text-red-400">{step1Error}</p>
                  </div>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Full Name</span>
                  <input type="text" value={step1.name}
                    onChange={(e) => setStep1((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Jordan Lee" className={inputClass} autoComplete="name" required />
                  {fieldError(step1FieldErrors, "name")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Email</span>
                  <input type="email" value={step1.email}
                    onChange={(e) => setStep1((p) => ({ ...p, email: e.target.value }))}
                    placeholder="you@studio.com" className={inputClass} autoComplete="email" required />
                  {fieldError(step1FieldErrors, "email")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Password</span>
                  <input type="password" value={step1.password}
                    onChange={(e) => setStep1((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Min 8 chars, 1 uppercase, 1 number"
                    className={inputClass} autoComplete="new-password" required />
                  {fieldError(step1FieldErrors, "password")}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Confirm Password</span>
                  <input type="password" value={step1.confirm_password}
                    onChange={(e) => setStep1((p) => ({ ...p, confirm_password: e.target.value }))}
                    placeholder="••••••••" className={inputClass} autoComplete="new-password" required />
                  {fieldError(step1FieldErrors, "confirm_password")}
                </label>

                <button type="submit" disabled={step1Loading}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
                  {step1Loading && <Spinner className="h-4 w-4 text-white" />}
                  {step1Loading ? "Creating account…" : "Continue →"}
                </button>
              </form>
            </div>
          )}

          {/* ── Step 2 ── */}
          {tokenState.status === "valid" && step === 2 && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
              <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
                Complete your profile
              </h2>
              <p className="font-body text-sm text-overlay-muted mb-7">Step 2 of 3</p>

              <form onSubmit={handleStep2} className="flex flex-col gap-4">
                {step2Error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="font-body text-sm text-red-400">{step2Error}</p>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Company <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={companies.map((c) => ({ value: c.id, label: c.name }))}
                    value={step2.company_id} onChange={(v) => setStep2((p) => ({ ...p, company_id: v }))}
                    placeholder="Select a company" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    City <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={cities.map((c) => ({ value: c.id, label: c.name }))}
                    value={step2.city_id} onChange={(v) => setStep2((p) => ({ ...p, city_id: v }))}
                    placeholder="Select a city" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Industry Sector <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={sectors.map((s) => ({ value: s.id, label: s.name }))}
                    value={step2.sector_id} onChange={(v) => setStep2((p) => ({ ...p, sector_id: v }))}
                    placeholder="Select a sector" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Experience Level <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={EXPERIENCE_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
                    value={step2.experience_level} onChange={(v) => setStep2((p) => ({ ...p, experience_level: v }))}
                    placeholder="Select your level" />
                </div>

                <button type="submit" disabled={step2Loading}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed">
                  {step2Loading && <Spinner className="h-4 w-4 text-white" />}
                  {step2Loading ? "Saving…" : "Continue →"}
                </button>
              </form>
            </div>
          )}

          {/* ── Step 3: Avatar ── */}
          {tokenState.status === "valid" && step === 3 && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
              <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
                Choose your avatar
              </h2>
              <p className="font-body text-sm text-overlay-muted mb-6">Step 3 of 3</p>

              {step3Error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
                  <p className="font-body text-sm text-red-400">{step3Error}</p>
                </div>
              )}

              <div className="mb-5 overflow-hidden rounded-xl border border-overlay-elevated">
                <div className="flex gap-1 border-b border-overlay-elevated bg-overlay px-2 py-2">
                  {avatarTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveAvatarTab(tab.key)}
                      className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2.5 py-2 font-body text-xs font-medium transition-colors ${
                        activeAvatarTab === tab.key
                          ? "bg-accent text-accent-foreground"
                          : "text-overlay-muted hover:bg-overlay-elevated hover:text-overlay-foreground"
                      }`}
                    >
                      <span className="truncate">{tab.label}</span>
                      <span className="shrink-0 opacity-70">{tab.count}</span>
                    </button>
                  ))}
                </div>

                <div className="max-h-[310px] overflow-y-auto p-3">
                  <div className="grid grid-cols-4 gap-2.5">
                    {visibleAvatarOptions.map((option) => {
                      const isSelected = selectedAvatar?.id === option.id && !uploadPreviewUrl;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handlePickAvatar(option)}
                          title={option.label}
                          className={`relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl p-1.5 transition-all focus:outline-none ${
                            isSelected ? "ring-2 ring-accent bg-accent/10" : "hover:bg-overlay-elevated"
                          }`}
                        >
                          <AvatarPreview option={option} size={52} />
                          <span className="w-full truncate text-center font-body text-[10px] leading-none text-overlay-muted">
                            {option.label}
                          </span>
                          {isSelected && (
                            <span className="absolute bottom-6 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                              <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-overlay-elevated" />
                <span className="font-body text-xs text-overlay-muted">or upload your own</span>
                <div className="flex-1 h-px bg-overlay-elevated" />
              </div>

              {/* Upload */}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                className="hidden" onChange={handleFileSelect} />

              {uploadPreviewUrl ? (
                <div className="flex items-center gap-4 mb-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadPreviewUrl} alt="Your uploaded photo"
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-accent" />
                  <div>
                    <p className="font-body text-sm font-medium text-overlay-foreground">Photo ready</p>
                    <p className="font-body text-xs text-overlay-muted mt-0.5">Compressed &amp; cropped to 300×300</p>
                    <button type="button"
                      onClick={() => {
                        if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
                        setUploadPreviewUrl(null);
                        setUploadedBlob(null);
                        setSelectedAvatar(avatarSourceOptions[activeAvatarTab][0] ?? avatarSourceOptions.all[0] ?? null);
                      }}
                      className="mt-1 font-body text-xs text-overlay-muted hover:text-red-400 transition-colors">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="mb-5 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-overlay-elevated px-4 py-3 font-body text-sm text-overlay-muted hover:border-accent hover:text-overlay-foreground transition-colors">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                  Upload photo (JPEG / PNG / WebP)
                </button>
              )}

              {/* Save — required, no skip */}
              <button
                type="button"
                onClick={handleStep3}
                disabled={step3Loading || (!selectedAvatar && !uploadedBlob)}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step3Loading && <Spinner className="h-4 w-4 text-white" />}
                {step3Loading ? "Saving…" : "Save & go to dashboard →"}
              </button>
            </div>
          )}

          {/* ── Done ── */}
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

    </>
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
