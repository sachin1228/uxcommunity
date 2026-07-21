"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Linkedin,
  Globe,
  Pencil,
  Check,
  X,
  Upload,
  Camera,
  MapPin,
  Building2,
  Layers,
  Star,
  Calendar,
  Mail,
  ChevronDown,
  Lock,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { compressImage } from "@/lib/compressImage";
import Avatar from "boring-avatars";

// ─── Avatar preview helpers (mirrored from signup step 4) ────────────────

const ALL_DICEBEAR_STYLES: { style: string; label: string }[] = [
  { style: "adventurer",          label: "Adventurer" },
  { style: "adventurer-neutral",  label: "Adventurer Neutral" },
  { style: "avataaars",           label: "Avataaars" },
  { style: "avataaars-neutral",   label: "Avataaars Neutral" },
  { style: "big-ears",            label: "Big Ears" },
  { style: "big-ears-neutral",    label: "Big Ears Neutral" },
  { style: "big-smile",           label: "Big Smile" },
  { style: "bottts",              label: "Bottts" },
  { style: "bottts-neutral",      label: "Bottts Neutral" },
  { style: "croodles",            label: "Croodles" },
  { style: "croodles-neutral",    label: "Croodles Neutral" },
  { style: "dylan",               label: "Dylan" },
  { style: "fun-emoji",           label: "Fun Emoji" },
  { style: "glass",               label: "Glass" },
  { style: "identicon",           label: "Identicon" },
  { style: "initials",            label: "Initials" },
  { style: "lorelei",             label: "Lorelei" },
  { style: "lorelei-neutral",     label: "Lorelei Neutral" },
  { style: "micah",               label: "Micah" },
  { style: "miniavs",             label: "Miniavs" },
  { style: "notionists",          label: "Notionists" },
  { style: "notionists-neutral",  label: "Notionists Neutral" },
  { style: "open-peeps",          label: "Open Peeps" },
  { style: "personas",            label: "Personas" },
  { style: "pixel-art",           label: "Pixel Art" },
  { style: "pixel-art-neutral",   label: "Pixel Art Neutral" },
  { style: "rings",               label: "Rings" },
  { style: "shapes",              label: "Shapes" },
  { style: "thumbs",              label: "Thumbs" },
];

const ALL_BORING_STYLES: { style: string; label: string }[] = [
  { style: "marble",    label: "Marble" },
  { style: "beam",      label: "Beam" },
  { style: "pixel",     label: "Pixel" },
  { style: "sunset",    label: "Sunset" },
  { style: "ring",      label: "Ring" },
  { style: "bauhaus",   label: "Bauhaus" },
  { style: "triangles", label: "Triangles" },
];

const ALL_ROBOHASH_SETS: { set: string; label: string }[] = [
  { set: "set1", label: "Robots" },
  { set: "set2", label: "Monsters" },
  { set: "set3", label: "Robot Heads" },
  { set: "set4", label: "Kittens" },
];

const ALL_MULTIAVATAR_SEEDS: string[] = [
  "Alex","Jamie","Riley","Morgan",
  "Casey","Quinn","Avery","Blake",
  "Taylor","Jordan","Phoenix","Sage",
  "Drew","Reese","Dakota","Finley",
  "Rowan","Skylar","Lennon","Remy",
];

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

type AvatarSource = "dicebear" | "boring-avatars" | "robohash" | "avataaars" | "multiavatar";

interface AvatarOption {
  id: string;
  source: AvatarSource;
  style: string;
  label: string;
  dbUrl: string;
  seed: string;
}

function getAllAvatarOptions(name: string) {
  const baseName = name || "designer";
  const seedNames = Array.from({ length: 6 }, (_, i) =>
    i === 0 ? baseName : `${baseName} ${i + 1}`
  );

  const dicebear = ALL_DICEBEAR_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, i) => ({
      id: `dicebear-${style}-${i}`,
      source: "dicebear" as AvatarSource,
      style,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seedName)}`,
      seed: seedName,
    }))
  );
  const boring = ALL_BORING_STYLES.flatMap(({ style, label }) =>
    seedNames.map((seedName, i) => ({
      id: `boring-${style}-${i}`,
      source: "boring-avatars" as AvatarSource,
      style,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `boring://${style}/${encodeURIComponent(seedName)}`,
      seed: seedName,
    }))
  );
  const robohash = ALL_ROBOHASH_SETS.flatMap(({ set, label }) =>
    seedNames.map((seedName, i) => ({
      id: `robohash-${set}-${i}`,
      source: "robohash" as AvatarSource,
      style: set,
      label: i === 0 ? label : `${label} ${i + 1}`,
      dbUrl: `https://robohash.org/${encodeURIComponent(seedName)}?set=${set}&size=200x200`,
      seed: seedName,
    }))
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
  return { dicebear, boring, robohash, avataaars, multiavatar };
}

function getAvatarLibLabel(source: AvatarSource) {
  if (source === "dicebear")       return "DiceBear";
  if (source === "boring-avatars") return "Boring Avs";
  if (source === "robohash")       return "Robohash";
  if (source === "avataaars")      return "Avataaars";
  return "Multiavatar";
}

function AvatarPreview({ opt, size = 60 }: { opt: AvatarOption; size?: number }) {
  if (opt.source === "boring-avatars") {
    return (
      <span style={{ width: size, height: size, display: "inline-flex", borderRadius: "50%", overflow: "hidden" }}>
        <Avatar size={size} name={opt.seed} variant={opt.style as "marble"} />
      </span>
    );
  }
  return (
    <img src={opt.dbUrl} alt={opt.label} width={size} height={size}
      className="rounded-full object-cover bg-overlay-elevated" loading="lazy" />
  );
}

// ─── Interest emoji map ───────────────────────────────────────────────────

const INTEREST_EMOJIS: Record<string, string> = {
  "UI / UX Design": "🧑‍🎨", "Product Design": "📦", "Graphic Design": "✏️",
  "Illustration": "🖌️", "Visual Design": "👁️", "Motion Design": "🎬",
  "Brand Identity": "🏷️", "Typography": "🔤", "Design Systems": "🧩",
  "User Research": "🔍", "Interaction Design": "🖱️", "Accessibility": "♿",
  "Design Leadership": "👥", "Design Strategy": "🗺️", "Industrial Design": "📐",
  "Web Design": "🌐", "Game Design": "🎮", "Photography": "📸",
  "3D Design": "🗿", "Other": "✨",
};

// ─── Paper-clip SVG ───────────────────────────────────────────────────────

function PaperClip() {
  return (
    <svg viewBox="0 0 32 72" className="w-6 h-14 text-foreground-muted/60 drop-shadow-sm" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M16 68 C5 68 2 60 2 52 L2 20 C2 10 8 4 16 4 C24 4 30 10 30 20 L30 52 C30 58 26 64 20 64 C14 64 10 59 10 53 L10 22 C10 17 13 14 16 14 C19 14 22 17 22 22 L22 52" />
    </svg>
  );
}

// ─── Section badge ────────────────────────────────────────────────────────

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="font-mono text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">{num}</span>
      <span className="font-display text-xs font-semibold text-foreground-muted uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Inline edit field ────────────────────────────────────────────────────

function InlineField({
  label, value, onChange, placeholder, multiline = false, icon,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  icon?: React.ReactNode;
  type?: string;
}) {
  const cls =
    "bg-transparent border-b border-border focus:border-accent outline-none text-foreground font-body text-sm transition-colors w-full pb-0.5 placeholder:text-foreground-subtle resize-none";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={cls + " leading-relaxed"}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  initialName: string;
  email: string;
  createdAt: string;
  avatarUrl: string | null;
  avatarSource: string | null;
  city: string | null;
  company: string | null;
  sector: string | null;
  experienceLevel: string | null;
  initialLinkedIn: string;
  initialPortfolio: string;
  initialBio: string;
  initialInterestIds: string[];
  allInterests: { id: string; name: string; image_url?: string | null }[];
}

// ─── Main component ───────────────────────────────────────────────────────

export function ProfileClient({
  initialName, email, createdAt, avatarUrl: initialAvatarUrl,
  city, company, sector, experienceLevel,
  initialLinkedIn, initialPortfolio, initialBio,
  initialInterestIds, allInterests,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [linkedin, setLinkedin] = useState(initialLinkedIn);
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [interestIds, setInterestIds] = useState<string[]>(initialInterestIds);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarTab, setAvatarTab] = useState<"generated" | "upload">("generated");
  const [activeAvatarLibTab, setActiveAvatarLibTab] = useState<AvatarSource>("dicebear");
  const [pickedAvatar, setPickedAvatar] = useState<AvatarOption | null>(null);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Interests dropdown
  const [interestsOpen, setInterestsOpen] = useState(false);
  const interestsRef = useRef<HTMLDivElement>(null);

  const avatarLibOptions = useMemo(() => getAllAvatarOptions(name || initialName), [name, initialName]);
  const avatarLibTabs: { key: AvatarSource; label: string; count: number }[] = [
    { key: "dicebear",        label: getAvatarLibLabel("dicebear"),        count: avatarLibOptions.dicebear.length },
    { key: "boring-avatars",  label: getAvatarLibLabel("boring-avatars"),  count: avatarLibOptions.boring.length },
    { key: "robohash",        label: getAvatarLibLabel("robohash"),        count: avatarLibOptions.robohash.length },
    { key: "avataaars",       label: getAvatarLibLabel("avataaars"),       count: avatarLibOptions.avataaars.length },
    { key: "multiavatar",     label: getAvatarLibLabel("multiavatar"),     count: avatarLibOptions.multiavatar.length },
  ];
  const visibleAvatarOptions = activeAvatarLibTab === "boring-avatars"
    ? avatarLibOptions.boring
    : avatarLibOptions[activeAvatarLibTab as keyof typeof avatarLibOptions] as AvatarOption[];

  // Close interests dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (interestsRef.current && !interestsRef.current.contains(e.target as Node)) {
        setInterestsOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  // ── Save profile ───────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const [profileRes, interestsRes] = await Promise.all([
        fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), bio, linkedin_url: linkedin, portfolio_url: portfolio }),
        }),
        fetch("/api/profile/interests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interest_ids: interestIds }),
        }),
      ]);

      if (!profileRes.ok) {
        const d = await profileRes.json();
        setSaveError(d.error ?? "Failed to save profile.");
        return;
      }
      if (!interestsRes.ok) {
        const d = await interestsRes.json();
        setSaveError(d.error ?? "Failed to save interests.");
        return;
      }

      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Avatar file select ─────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setAvatarError(null);
    try {
      const compressed = await compressImage(file);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadBlob(compressed);
      setUploadPreview(URL.createObjectURL(compressed));
      setPickedAvatar(null);
    } catch {
      setAvatarError("Failed to process image. Please try a different file.");
    }
  }

  // ── Save avatar ────────────────────────────────────────────
  async function handleSaveAvatar() {
    if (!uploadBlob && !pickedAvatar) return;
    setAvatarSaving(true);
    setAvatarError(null);
    try {
      let res: Response;
      if (uploadBlob) {
        const fd = new FormData();
        fd.append("file", uploadBlob, "avatar.jpg");
        res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar_url: pickedAvatar!.dbUrl, avatar_source: pickedAvatar!.source }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setAvatarError(data.error ?? "Failed to update avatar.");
        return;
      }
      setAvatarUrl(data.avatar_url);
      setShowAvatarPicker(false);
      setPickedAvatar(null);
      setUploadBlob(null);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(null);
      router.refresh();
    } catch {
      setAvatarError("Network error. Please try again.");
    } finally {
      setAvatarSaving(false);
    }
  }

  function closeAvatarPicker() {
    setShowAvatarPicker(false);
    setPickedAvatar(null);
    setUploadBlob(null);
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setAvatarError(null);
  }

  const selectedInterests = allInterests.filter((i) => interestIds.includes(i.id));

  const hasChanges =
    name !== initialName ||
    bio !== initialBio ||
    linkedin !== initialLinkedIn ||
    portfolio !== initialPortfolio ||
    JSON.stringify([...interestIds].sort()) !== JSON.stringify([...initialInterestIds].sort());

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Your Profile</h1>
          <p className="font-body text-sm text-foreground-muted mt-0.5">
            How you appear to others in the community
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`flex items-center gap-2 rounded-lg px-5 py-2.5 font-body text-sm font-medium transition-all ${
            saved
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : hasChanges
              ? "bg-accent text-accent-foreground hover:bg-accent-hover shadow-sm"
              : "bg-surface text-foreground-subtle border border-border cursor-not-allowed"
          }`}
        >
          {saving && <Spinner className="h-3.5 w-3.5" />}
          {saved ? (
            <><Check size={14} /> Saved!</>
          ) : saving ? (
            "Saving…"
          ) : (
            "Save Changes"
          )}
        </button>
      </div>

      {saveError && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="font-body text-sm text-red-400">{saveError}</p>
        </div>
      )}

      {/* ── Hero: Avatar + Basic Info ── */}
      <div className="rounded-2xl border border-border bg-surface p-7 mb-5 relative overflow-hidden">
        {/* subtle decorative dots */}
        <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "16px 16px" }} />

        <div className="flex gap-8 items-start relative">
          {/* ── Pinned photo ── */}
          <div className="shrink-0 flex flex-col items-center gap-3">
            <div className="relative" style={{ transform: "rotate(-3deg)" }}>
              {/* Paper clip */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10">
                <PaperClip />
              </div>
              {/* Polaroid frame */}
              <div className="bg-white p-2 pb-3 shadow-xl rounded-sm mt-4" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)" }}>
                <div className="w-28 h-28 overflow-hidden rounded-sm bg-overlay-elevated">
                  {avatarUrl ? (
                    <AvatarImg url={avatarUrl} name={name} size={112} className="w-28 h-28 object-cover" />
                  ) : (
                    <div className="w-28 h-28 flex items-center justify-center bg-accent/20">
                      <span className="font-display text-4xl font-bold text-accent">
                        {name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowAvatarPicker(true)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground-muted hover:text-accent hover:border-accent/40 transition-all mt-2"
            >
              <Camera size={11} />
              Change photo
            </button>
          </div>

          {/* ── Identity fields ── */}
          <div className="flex-1 grid grid-cols-1 gap-5 pt-1">
            <InlineField
              label="Display Name"
              value={name}
              onChange={setName}
              placeholder="Your name"
            />
            {/* Email — read only */}
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                <Mail size={11} />
                Email
              </label>
              <p className="font-body text-sm text-foreground-subtle pb-0.5 border-b border-border/40">{email}</p>
            </div>
            {memberSince && (
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar size={11} />
                  Member Since
                </label>
                <p className="font-body text-sm text-foreground-subtle pb-0.5 border-b border-border/40">{memberSince}</p>
              </div>
            )}
          </div>

          {/* ── Bio ── */}
          <div className="w-56 pt-1">
            <InlineField
              label="Bio"
              value={bio}
              onChange={setBio}
              placeholder="A short note about yourself — what you design, love, or believe in…"
              multiline
            />
          </div>
        </div>
      </div>

      {/* ── 01 / Identity (read-only) ── */}
      <div className="rounded-2xl border border-border bg-surface p-6 mb-5">
        <SectionLabel num="01" label="Professional Identity" />
        <div className="flex flex-wrap gap-3 mb-3">
          {city && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
              <MapPin size={13} className="text-accent shrink-0" />
              <span className="font-body text-sm text-foreground">{city}</span>
            </div>
          )}
          {company && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
              <Building2 size={13} className="text-accent shrink-0" />
              <span className="font-body text-sm text-foreground">{company}</span>
            </div>
          )}
          {sector && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
              <Layers size={13} className="text-accent shrink-0" />
              <span className="font-body text-sm text-foreground">{sector}</span>
            </div>
          )}
          {experienceLevel && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
              <Star size={13} className="text-accent shrink-0" />
              <span className="font-body text-sm text-foreground capitalize">
                {experienceLevel.replace(/_/g, " ")}
              </span>
            </div>
          )}
        </div>
        <p className="flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
          <Lock size={10} />
          These are linked to your community membership and can't be changed here.
        </p>
      </div>

      {/* ── 02 / Links ── */}
      <div className="rounded-2xl border border-border bg-surface p-6 mb-5">
        <SectionLabel num="02" label="Links" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <InlineField
            label="LinkedIn"
            value={linkedin}
            onChange={setLinkedin}
            placeholder="https://linkedin.com/in/yourname"
            icon={<Linkedin size={11} />}
            type="url"
          />
          <InlineField
            label="Portfolio"
            value={portfolio}
            onChange={setPortfolio}
            placeholder="https://yourportfolio.com"
            icon={<Globe size={11} />}
            type="url"
          />
        </div>
      </div>

      {/* ── 03 / Interests ── */}
      <div className="rounded-2xl border border-border bg-surface p-6 mb-8">
        <SectionLabel num="03" label="Design Interests" />

        {/* Selected chips */}
        <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
          {selectedInterests.length === 0 ? (
            <span className="font-body text-sm text-foreground-subtle italic">No interests selected yet</span>
          ) : (
            selectedInterests.map((interest) => (
              <button
                key={interest.id}
                type="button"
                onClick={() => setInterestIds((ids) => ids.filter((id) => id !== interest.id))}
                className="group flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-body text-xs text-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 transition-all"
              >
                <span>{INTEREST_EMOJIS[interest.name] ?? "🎨"}</span>
                {interest.name}
                <X size={10} className="opacity-50 group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>

        {/* Dropdown trigger */}
        <div ref={interestsRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => setInterestsOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border hover:border-accent/40 bg-surface-raised px-4 py-2 font-body text-sm text-foreground-muted hover:text-foreground transition-all"
          >
            <Pencil size={12} />
            Edit interests
            <ChevronDown size={12} className={`transition-transform ${interestsOpen ? "rotate-180" : ""}`} />
          </button>

          {interestsOpen && (
            <div className="absolute left-0 top-full mt-2 z-30 w-72 rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                {allInterests.map((interest) => {
                  const selected = interestIds.includes(interest.id);
                  return (
                    <button
                      key={interest.id}
                      type="button"
                      onClick={() =>
                        setInterestIds((ids) =>
                          selected ? ids.filter((id) => id !== interest.id) : [...ids, interest.id]
                        )
                      }
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-raised transition-colors"
                    >
                      <span className="text-base leading-none shrink-0">
                        {INTEREST_EMOJIS[interest.name] ?? "🎨"}
                      </span>
                      <span className="flex-1 font-body text-sm text-foreground">{interest.name}</span>
                      <span
                        className={`h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                          selected ? "bg-accent" : "border border-border"
                        }`}
                      >
                        {selected && (
                          <Check size={10} className="text-white" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky bottom save bar (mobile-friendly) ── */}
      {hasChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-border bg-surface/90 backdrop-blur-md px-5 py-3 shadow-xl">
          <span className="font-body text-sm text-foreground-muted">You have unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-60"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* ── Avatar picker modal ── */}
      {showAvatarPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeAvatarPicker(); }}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="font-display text-base font-semibold text-foreground">Change your photo</h3>
              <button onClick={closeAvatarPicker} className="text-foreground-muted hover:text-foreground transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              {(["generated", "upload"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAvatarTab(tab)}
                  className={`flex-1 py-3 font-body text-sm font-medium transition-colors ${
                    avatarTab === tab
                      ? "text-accent border-b-2 border-accent"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {tab === "generated" ? "Generated avatars" : "Upload photo"}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="p-5">
              {avatarError && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="font-body text-sm text-red-400">{avatarError}</p>
                </div>
              )}

              {avatarTab === "generated" ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  {/* Library tabs */}
                  <div className="flex gap-1 border-b border-border bg-surface px-2 py-2">
                    {avatarLibTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveAvatarLibTab(tab.key)}
                        className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 font-body text-xs font-medium transition-colors ${
                          activeAvatarLibTab === tab.key
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{tab.label}</span>
                        <span className="shrink-0 opacity-70">{tab.count}</span>
                      </button>
                    ))}
                  </div>
                  {/* Grid */}
                  <div className="max-h-[310px] overflow-y-auto p-3">
                    <div className="grid grid-cols-4 gap-2.5">
                      {visibleAvatarOptions.map((opt) => {
                        const isSel = pickedAvatar?.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => { setPickedAvatar(opt); setUploadBlob(null); if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadPreview(null); }}
                            className={`relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl p-1.5 transition-all focus:outline-none ${
                              isSel ? "ring-2 ring-accent bg-accent/10" : "hover:bg-surface-raised"
                            }`}
                          >
                            <AvatarPreview opt={opt} size={52} />
                            <span className="w-full truncate text-center font-body text-[10px] leading-none text-foreground-subtle">
                              {opt.label}
                            </span>
                            {isSel && (
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
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  {uploadPreview ? (
                    <div className="flex items-center gap-4 py-4">
                      <img src={uploadPreview} alt="Preview" className="h-20 w-20 rounded-full object-cover ring-2 ring-accent" />
                      <div>
                        <p className="font-body text-sm font-medium text-foreground">Photo ready</p>
                        <p className="font-body text-xs text-foreground-muted mt-0.5">Cropped & compressed to 300×300</p>
                        <button
                          type="button"
                          onClick={() => { if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadPreview(null); setUploadBlob(null); }}
                          className="mt-1 font-body text-xs text-foreground-muted hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-accent/50 py-10 text-foreground-muted hover:text-foreground transition-all"
                    >
                      <Upload size={24} className="opacity-60" />
                      <div className="text-center">
                        <p className="font-body text-sm font-medium">Click to upload</p>
                        <p className="font-body text-xs text-foreground-subtle mt-0.5">JPEG, PNG or WebP · max 5 MB</p>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button
                onClick={closeAvatarPicker}
                className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAvatar}
                disabled={avatarSaving || (!pickedAvatar && !uploadBlob)}
                className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {avatarSaving && <Spinner className="h-3.5 w-3.5" />}
                {avatarSaving ? "Saving…" : "Use this photo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
