"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME } from "@draft/shared";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import Avatar from "boring-avatars";
import { compressImage } from "@/lib/compressImage";

// ─── Constants ────────────────────────────────────────────────

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
  { style: "initials",           label: "Initials" },
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

// Multiavatar seeds — one unique SVG per seed (api.multiavatar.com)
const ALL_MULTIAVATAR_SEEDS: string[] = [
  "Alex", "Jamie", "Riley", "Morgan",
  "Casey", "Quinn", "Avery", "Blake",
  "Taylor", "Jordan", "Phoenix", "Sage",
  "Drew", "Reese", "Dakota", "Finley",
  "Rowan", "Skylar", "Lennon", "Remy",
];

// Avataaars pre-configured styles (avataaars.io URL-based)
const ALL_AVATAAARS_CONFIGS: { id: string; label: string; params: string }[] = [
  { id: "sharp",   label: "Sharp",   params: "topType=ShortHairShortWaved&accessoriesType=Blank&hairColor=BrownDark&facialHairType=Blank&clotheType=BlazerShirt&clotheColor=Black&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "bun",     label: "Bun",     params: "topType=LongHairBun&accessoriesType=Blank&hairColor=Auburn&facialHairType=Blank&clotheType=Hoodie&clotheColor=Blue01&eyeType=Happy&eyebrowType=RaisedExcited&mouthType=Smile&skinColor=Pale" },
  { id: "curly",   label: "Curly",   params: "topType=LongHairCurly&accessoriesType=Blank&hairColor=Black&facialHairType=Blank&clotheType=ShirtScoopNeck&clotheColor=PastelBlue&eyeType=Wink&eyebrowType=Default&mouthType=Smile&skinColor=Brown" },
  { id: "dreads",  label: "Dreads",  params: "topType=LongHairDreads&accessoriesType=Blank&hairColor=Black&facialHairType=Blank&clotheType=GraphicShirt&clotheColor=Gray01&eyeType=Default&eyebrowType=Default&mouthType=Default&skinColor=DarkBrown" },
  { id: "wavy",    label: "Wavy",    params: "topType=LongHairFro&accessoriesType=Blank&hairColor=Blonde&facialHairType=Blank&clotheType=CollarSweater&clotheColor=PastelOrange&eyeType=Squint&eyebrowType=Default&mouthType=Smile&skinColor=Tanned" },
  { id: "shaggy",  label: "Shaggy",  params: "topType=ShortHairShaggy&accessoriesType=Blank&hairColor=BlondeGolden&facialHairType=BeardLight&clotheType=ShirtCrewNeck&clotheColor=Blue01&eyeType=Default&eyebrowType=Default&mouthType=Default&skinColor=Light" },
  { id: "glasses", label: "Glasses", params: "topType=ShortHairSides&accessoriesType=Prescription01&hairColor=Brown&facialHairType=Blank&clotheType=BlazerSweater&clotheColor=Black&eyeType=Default&eyebrowType=Default&mouthType=Twinkle&skinColor=Pale" },
  { id: "hat",     label: "Hat",     params: "topType=WinterHat1&accessoriesType=Blank&hatColor=Blue01&facialHairType=Blank&clotheType=Overall&clotheColor=PastelGreen&eyeType=Happy&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "turban",  label: "Turban",  params: "topType=Turban&accessoriesType=Blank&hatColor=PastelOrange&facialHairType=Blank&clotheType=ShirtCrewNeck&clotheColor=PastelYellow&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Tanned" },
  { id: "hijab",   label: "Hijab",   params: "topType=Hijab&accessoriesType=Blank&hatColor=Blue02&facialHairType=Blank&clotheType=BlazerShirt&clotheColor=Black&eyeType=Happy&eyebrowType=Default&mouthType=Smile&skinColor=Brown" },
  { id: "flat",    label: "Flat",    params: "topType=ShortHairShortFlat&accessoriesType=Blank&hairColor=Red&facialHairType=Blank&clotheType=Hoodie&clotheColor=PastelRed&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=Light" },
  { id: "mohawk",  label: "Mohawk",  params: "topType=ShortHairFrizzle&accessoriesType=Sunglasses&hairColor=SilverGray&facialHairType=Blank&clotheType=GraphicShirt&clotheColor=Gray02&eyeType=Default&eyebrowType=Default&mouthType=Smile&skinColor=DarkBrown" },
];

// ─── Types ────────────────────────────────────────────────────

type AvatarSource = "dicebear" | "boring-avatars" | "robohash" | "avataaars" | "multiavatar";

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

interface MasterItem { id: string; name: string; image_url?: string | null }

interface TokenState {
  status: "loading" | "valid" | "invalid";
  error?: string;
  applicationId?: string;
  applicantEmail?: string;
  /** When the server detects an incomplete signup, jump straight to this step. */
  resumeStep?: 2 | 3 | 4;
}

type Step = 1 | 2 | 3 | 4 | "done";

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

  const avataaars = ALL_AVATAAARS_CONFIGS.map(({ id, label, params }) => ({
    id: `avataaars-${id}`,
    source: "avataaars" as AvatarSource,
    style: "avataaars",
    label,
    dbUrl: `https://avataaars.io/?avatarStyle=Circle&${params}`,
    seed: label,
  }));

  const multiavatar = ALL_MULTIAVATAR_SEEDS.map((seedName) => ({
    id: `multiavatar-${seedName}`,
    source: "multiavatar" as AvatarSource,
    style: "open-peeps",
    label: seedName,
    dbUrl: `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(seedName)}`,
    seed: seedName,
  }));

  return [...dicebear, ...boring, ...robohash, ...avataaars, ...multiavatar];
}

function getAvatarTabLabel(source: AvatarSource) {
  if (source === "dicebear") return "DiceBear";
  if (source === "boring-avatars") return "Boring Avs";
  if (source === "robohash") return "Robohash";
  if (source === "avataaars") return "Avataaars";
  return "Multiavatar";
}

function getAvatarSourceOptions(name: string) {
  const all = getAllAvatarOptions(name);
  return {
    all,
    dicebear:        all.filter((o) => o.source === "dicebear"),
    "boring-avatars":all.filter((o) => o.source === "boring-avatars"),
    robohash:        all.filter((o) => o.source === "robohash"),
    avataaars:       all.filter((o) => o.source === "avataaars"),
    multiavatar:     all.filter((o) => o.source === "multiavatar"),
  };
}

/** Compress + center-crop a file to 300×300 JPEG via Canvas. */
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

// ─── Interest emoji mapping (frontend-side) ──────────────────

export const INTEREST_EMOJIS: Record<string, string> = {
  "UI / UX Design":     "🧑‍🎨",
  "Product Design":     "📦",
  "Graphic Design":     "✏️",
  "Illustration":       "🖌️",
  "Visual Design":      "👁️",
  "Motion Design":      "🎬",
  "Brand Identity":     "🏷️",
  "Typography":         "🔤",
  "Design Systems":     "🧩",
  "User Research":      "🔍",
  "Interaction Design": "🖱️",
  "Accessibility":      "♿",
  "Design Leadership":  "👥",
  "Design Strategy":    "🗺️",
  "Industrial Design":  "📐",
  "Web Design":         "🌐",
  "Game Design":        "🎮",
  "Photography":        "📸",
  "3D Design":          "🗿",
  "Other":              "✨",
};

// ─── InterestIcon: shows uploaded image, falls back to emoji ──

function InterestIcon({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const emoji = INTEREST_EMOJIS[name] ?? "🎨";
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-5 w-5 rounded object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className="text-base leading-none">{emoji}</span>;
}

// ─── InterestsMultiSelect ─────────────────────────────────────

interface InterestOption { id: string; name: string; image_url?: string | null }

function InterestsMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: InterestOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  function remove(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  const selectedOptions = options.filter((o) => selected.includes(o.id));

  return (
    <div ref={containerRef} className="relative">
      {/* Input area */}
      <div
        onClick={() => setOpen((v) => !v)}
        className={`min-h-[42px] flex flex-wrap items-center gap-1.5 cursor-pointer rounded-md border px-3 py-2 transition-colors ${
          open
            ? "border-accent ring-2 ring-accent/20"
            : "border-overlay-elevated hover:border-overlay-muted"
        } bg-overlay`}
      >
        {selectedOptions.map((o) => (
          <span
            key={o.id}
            className="inline-flex items-center gap-1 rounded-md bg-overlay-elevated px-2 py-0.5 font-body text-xs text-overlay-foreground"
          >
            {o.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(o.id); }}
              className="text-overlay-muted hover:text-overlay-foreground transition-colors ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
        <span className="flex-1 min-w-[80px] font-body text-sm text-overlay-muted select-none">
          {selectedOptions.length === 0 ? "Select topics…" : ""}
        </span>
        <svg
          className={`h-4 w-4 text-overlay-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-overlay-elevated bg-overlay shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-overlay-elevated transition-colors"
                >
                  <InterestIcon imageUrl={option.image_url} name={option.name} />
                  <span className="flex-1 font-body text-sm text-overlay-foreground">
                    {option.name}
                  </span>
                  <span
                    className={`h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? "bg-accent" : "border border-overlay-muted"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
  const [showPassword,        setShowPassword]        = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 2
  const [step, setStep] = useState<Step>(1);
  const [companies, setCompanies] = useState<MasterItem[]>([]);
  const [cities,    setCities]    = useState<MasterItem[]>([]);
  const [sectors,   setSectors]   = useState<MasterItem[]>([]);
  const [experienceLevels, setExperienceLevels] = useState<{ id: string; slug: string; label: string; image_url: string | null }[]>([]);
  const [step2, setStep2] = useState({ company_id: "", city_id: "", sector_id: "", experience_level: "" });
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error,   setStep2Error]   = useState<string | null>(null);

  // Step 3 — Interests
  const [interestOptions, setInterestOptions] = useState<InterestOption[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [step3Loading, setStep3Loading] = useState(false);
  const [step3Error,   setStep3Error]   = useState<string | null>(null);

  // Step 4 — Avatar
  const [activeAvatarTab, setActiveAvatarTab] = useState<AvatarTab>("dicebear");
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarOption | null>(null);
  const [uploadedBlob, setUploadedBlob] = useState<Blob | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [step4Loading, setStep4Loading] = useState(false);
  const [step4Error,   setStep4Error]   = useState<string | null>(null);

  const avatarSourceOptions = useMemo(() => getAvatarSourceOptions(step1.name), [step1.name]);
  const avatarTabs: { key: AvatarTab; label: string; count: number }[] = [
    { key: "dicebear",       label: getAvatarTabLabel("dicebear"),        count: avatarSourceOptions.dicebear.length },
    { key: "boring-avatars", label: getAvatarTabLabel("boring-avatars"),  count: avatarSourceOptions["boring-avatars"].length },
    { key: "robohash",       label: getAvatarTabLabel("robohash"),        count: avatarSourceOptions.robohash.length },
    { key: "avataaars",      label: getAvatarTabLabel("avataaars"),       count: avatarSourceOptions.avataaars.length },
    { key: "multiavatar",    label: getAvatarTabLabel("multiavatar"),     count: avatarSourceOptions.multiavatar.length },
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
          setStep1((prev) => ({ ...prev, email: d.applicantEmail ?? "", name: d.applicantName ?? "" }));
          // If the server detected an incomplete signup in progress, jump
          // straight to the correct step (session cookie still valid from step 1).
          if (d.resumeStep === 2 || d.resumeStep === 3 || d.resumeStep === 4) {
            setStep(d.resumeStep as 2 | 3 | 4);
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
      fetch("/api/data/experience-levels").then((r) => r.json()).then((d) => setExperienceLevels(d.experience_levels ?? [])),
    ]).catch(() => {});
  }, [step]);

  // ── Load interests for step 3 ──────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    fetch("/api/data/interests")
      .then((r) => r.json())
      .then((d) => setInterestOptions(d.interests ?? []))
      .catch(() => {});
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
        if (data.redirectToLogin) {
          // Account is already fully set up — point to the login page.
          setStep1Error(data.error ?? "Your account is already set up. Please log in.");
          return;
        }
        if (data.issues) setStep1FieldErrors(data.issues);
        else setStep1Error(data.error ?? "Failed to create account.");
        return;
      }
      // When resuming a partial signup the server tells us which step to jump to.
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
      if (!res.ok) {
        if (res.status === 401) {
          // Session expired while the user was on step 2. Send them back to
          // step 1 so they can re-enter their password and get a fresh session.
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
    // interests are optional — allow continuing with none selected
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
      // Set up avatar options before moving to step 4
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
    // Require an avatar
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
          if (res.status === 401) {
            setStep1Error("Your session expired. Please re-enter your password to continue.");
            setStep(1);
            return;
          }
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
          if (res.status === 401) {
            setStep1Error("Your session expired. Please re-enter your password to continue.");
            setStep(1);
            return;
          }
          setStep4Error(data.error ?? "Failed to save avatar.");
          return;
        }
      }
      // Auto-join communities based on city / sector / interests.
      // Wait up to 4 s so the sidebar has joined communities on first load.
      // If it times out or errors, navigation still proceeds — communities
      // will appear after the user refreshes or revisits the page.
      try {
        await Promise.race([
          fetch("/api/communities/auto-join", { method: "POST" }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 4000)
          ),
        ]);
      } catch {
        // Non-fatal — carry on regardless
      }
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
        <div className="w-full max-w-xl">

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
              <p className="font-body text-sm text-overlay-muted mb-7">Step 1 of 4</p>

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
                    placeholder="you@studio.com" className={inputClass} autoComplete="username" required />
                  {fieldError(step1FieldErrors, "email")}
                </label>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Password</span>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} value={step1.password}
                      onChange={(e) => setStep1((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Min 8 chars, 1 number"
                      className={inputClass} autoComplete="new-password" required />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-overlay-muted hover:text-overlay-foreground transition-colors">
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  {fieldError(step1FieldErrors, "password")}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">Confirm Password</span>
                  <div className="relative">
                    <input type={showConfirmPassword ? "text" : "password"} value={step1.confirm_password}
                      onChange={(e) => setStep1((p) => ({ ...p, confirm_password: e.target.value }))}
                      placeholder="••••••••" className={inputClass} autoComplete="new-password" required />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-overlay-muted hover:text-overlay-foreground transition-colors">
                      {showConfirmPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  {fieldError(step1FieldErrors, "confirm_password")}
                </div>

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
              <p className="font-body text-sm text-overlay-muted mb-7">Step 2 of 4</p>

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
                  <SearchableSelect options={companies.map((c) => ({ value: c.id, label: c.name, imageUrl: c.image_url }))}
                    value={step2.company_id} onChange={(v) => setStep2((p) => ({ ...p, company_id: v }))}
                    placeholder="Select a company" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    City <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={cities.map((c) => ({ value: c.id, label: c.name, imageUrl: c.image_url }))}
                    value={step2.city_id} onChange={(v) => setStep2((p) => ({ ...p, city_id: v }))}
                    placeholder="Select a city" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Industry Sector <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect options={sectors.map((s) => ({ value: s.id, label: s.name, imageUrl: s.image_url }))}
                    value={step2.sector_id} onChange={(v) => setStep2((p) => ({ ...p, sector_id: v }))}
                    placeholder="Select a sector" allowOther otherLabel="Other" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-xs font-medium text-overlay-foreground">
                    Experience Level <span className="text-red-400">*</span>
                  </span>
                  <SearchableSelect
                    options={experienceLevels.map((l) => ({ value: l.slug, label: l.label, imageUrl: l.image_url }))}
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

          {/* ── Step 3: Interests ── */}
          {tokenState.status === "valid" && step === 3 && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
              <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
                What are your design interests?
              </h2>
              <p className="font-body text-sm text-overlay-muted mb-1">Step 3 of 4</p>
              <p className="font-body text-xs text-overlay-muted mb-7">
                Pick the topics you care about most. You can always update these later.
              </p>

              {step3Error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
                  <p className="font-body text-sm text-red-400">{step3Error}</p>
                </div>
              )}

              <div className="mb-6">
                <InterestsMultiSelect
                  options={interestOptions}
                  selected={selectedInterestIds}
                  onChange={setSelectedInterestIds}
                />
              </div>

              <button
                type="button"
                onClick={handleStep3}
                disabled={step3Loading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step3Loading && <Spinner className="h-4 w-4 text-white" />}
                {step3Loading ? "Saving…" : "Continue →"}
              </button>
            </div>
          )}

          {/* ── Step 4: Avatar ── */}
          {tokenState.status === "valid" && step === 4 && (
            <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
              <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
                Choose your avatar
              </h2>
              <p className="font-body text-sm text-overlay-muted mb-6">Step 4 of 4</p>

              {step4Error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
                  <p className="font-body text-sm text-red-400">{step4Error}</p>
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
                onClick={handleStep4}
                disabled={step4Loading || (!selectedAvatar && !uploadedBlob)}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step4Loading && <Spinner className="h-4 w-4 text-white" />}
                {step4Loading ? "Saving…" : "Save & go to dashboard →"}
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
