"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { compressImage } from "@/lib/compressImage";
import { getAvatarTabLabel, getAllAvatarOptions } from "@/lib/avatar";
import type { AvatarOption, AvatarSource } from "@/lib/avatar";
import { ProfileCard } from "./components/ProfileCard";
import { ProfileThreads } from "./components/ProfileThreads";
import { AvatarPickerModal } from "./components/AvatarPickerModal";
import type { ProfileThread } from "@/components/communities/threads/types";

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
  initialThreads: ProfileThread[];
  currentUserId: string;
}

export function ProfileClient({
  initialName, email, createdAt, avatarUrl: initialAvatarUrl,
  city, company, sector, experienceLevel,
  initialLinkedIn, initialPortfolio, initialBio,
  initialInterestIds, allInterests,
  initialThreads, currentUserId,
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
    <div className="max-w-4xl mx-auto  mt-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Your Profile</h1>
        <p className="font-body text-sm text-foreground-muted mt-0.5">
          How you appear to others in the community
        </p>
      </div>

      <ProfileCard
        name={name}
        email={email}
        avatarUrl={avatarUrl}
        memberSince={memberSince}
        onOpenAvatarPicker={() => setShowAvatarPicker(true)}
        city={city}
        company={company}
        sector={sector}
        experienceLevel={experienceLevel}
        linkedin={linkedin}
        portfolio={portfolio}
        onLinkedinChange={setLinkedin}
        onPortfolioChange={setPortfolio}
      />

      <ProfileThreads
        initialThreads={initialThreads}
        currentUserId={currentUserId}
        currentUserName={name}
        currentUserAvatar={avatarUrl}
      />


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
