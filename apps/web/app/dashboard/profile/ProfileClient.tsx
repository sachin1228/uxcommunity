"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { compressImage } from "@/lib/compressImage";
import { getAvatarTabLabel, getAllAvatarOptions } from "@/lib/avatar";
import type { AvatarOption, AvatarSource } from "@/lib/avatar";
import { ProfileHero } from "./components/ProfileHero";
import { ProfileIdentity } from "./components/ProfileIdentity";
import { ProfileLinks } from "./components/ProfileLinks";
import { ProfileInterests } from "./components/ProfileInterests";
import { AvatarPickerModal } from "./components/AvatarPickerModal";

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

export function ProfileClient({
  initialName, email, createdAt, avatarUrl: initialAvatarUrl,
  city, company, sector, experienceLevel,
  initialLinkedIn, initialPortfolio, initialBio,
  initialInterestIds, allInterests,
}: Props) {
  const router = useRouter();

  // Form state
  const [name,        setName]        = useState(initialName);
  const [bio,         setBio]         = useState(initialBio);
  const [linkedin,    setLinkedin]    = useState(initialLinkedIn);
  const [portfolio,   setPortfolio]   = useState(initialPortfolio);
  const [interestIds, setInterestIds] = useState<string[]>(initialInterestIds);

  // Avatar state
  const [avatarUrl,         setAvatarUrl]         = useState(initialAvatarUrl);
  const [showAvatarPicker,  setShowAvatarPicker]  = useState(false);
  const [avatarTab,         setAvatarTab]         = useState<"generated" | "upload">("generated");
  const [activeAvatarLib,   setActiveAvatarLib]   = useState<AvatarSource>("dicebear");
  const [pickedAvatar,      setPickedAvatar]      = useState<AvatarOption | null>(null);
  const [uploadBlob,        setUploadBlob]        = useState<Blob | null>(null);
  const [uploadPreview,     setUploadPreview]     = useState<string | null>(null);
  const [avatarSaving,      setAvatarSaving]      = useState(false);
  const [avatarError,       setAvatarError]       = useState<string | null>(null);

  // Save state
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved,     setSaved]     = useState(false);

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  const avatarLibOptions = useMemo(() => {
    const all = getAllAvatarOptions(name || initialName);
    return {
      dicebear:         all.filter((o) => o.source === "dicebear"),
      "boring-avatars": all.filter((o) => o.source === "boring-avatars"),
      robohash:         all.filter((o) => o.source === "robohash"),
      avataaars:        all.filter((o) => o.source === "avataaars"),
      multiavatar:      all.filter((o) => o.source === "multiavatar"),
    };
  }, [name, initialName]);

  const avatarLibTabs = (
    ["dicebear", "boring-avatars", "robohash", "avataaars", "multiavatar"] as AvatarSource[]
  ).map((key) => ({
    key,
    label: getAvatarTabLabel(key),
    count: (avatarLibOptions[key as keyof typeof avatarLibOptions] as AvatarOption[]).length,
  }));

  const visibleAvatarOptions =
    (avatarLibOptions[activeAvatarLib as keyof typeof avatarLibOptions] as AvatarOption[]) ?? [];

  const hasChanges =
    name !== initialName ||
    bio !== initialBio ||
    linkedin !== initialLinkedIn ||
    portfolio !== initialPortfolio ||
    JSON.stringify([...interestIds].sort()) !== JSON.stringify([...initialInterestIds].sort());

  // ── Save profile ────────────────────────────────────────────────────────
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

  // ── Avatar file select ──────────────────────────────────────────────────
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

  // ── Save avatar ─────────────────────────────────────────────────────────
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
      closeAvatarPicker();
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

  function handlePickAvatar(opt: AvatarOption) {
    setPickedAvatar(opt);
    setUploadBlob(null);
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
  }

  function handleRemoveUpload() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setUploadBlob(null);
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page header */}
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

      <ProfileHero
        name={name}
        email={email}
        avatarUrl={avatarUrl}
        memberSince={memberSince}
        bio={bio}
        onNameChange={setName}
        onBioChange={setBio}
        onOpenAvatarPicker={() => setShowAvatarPicker(true)}
      />

      <ProfileIdentity
        city={city}
        company={company}
        sector={sector}
        experienceLevel={experienceLevel}
      />

      <ProfileLinks
        linkedin={linkedin}
        portfolio={portfolio}
        onLinkedinChange={setLinkedin}
        onPortfolioChange={setPortfolio}
      />

      <ProfileInterests
        allInterests={allInterests}
        interestIds={interestIds}
        onChange={setInterestIds}
      />

      {/* Sticky save bar */}
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

      {/* Avatar picker modal */}
      {showAvatarPicker && (
        <AvatarPickerModal
          avatarTab={avatarTab}
          onTabChange={setAvatarTab}
          avatarLibTabs={avatarLibTabs}
          activeLibTab={activeAvatarLib}
          onLibTabChange={setActiveAvatarLib}
          visibleOptions={visibleAvatarOptions}
          pickedAvatar={pickedAvatar}
          uploadPreview={uploadPreview}
          saving={avatarSaving}
          error={avatarError}
          onPickAvatar={handlePickAvatar}
          onFileSelect={handleFileSelect}
          onRemoveUpload={handleRemoveUpload}
          onSave={handleSaveAvatar}
          onClose={closeAvatarPicker}
        />
      )}
    </div>
  );
}
