"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/compressImage";
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
  initialName,
  email,
  createdAt,
  avatarUrl: initialAvatarUrl,
  city,
  company,
  sector,
  experienceLevel,
  initialLinkedIn,
  initialPortfolio,
  initialThreads,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [name] = useState(initialName);
  const [linkedin, setLinkedin] = useState(initialLinkedIn);
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  useEffect(() => {
    return () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setPictureError(null);
    try {
      const compressed = await compressImage(file);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadBlob(compressed);
      setUploadPreview(URL.createObjectURL(compressed));
    } catch {
      setPictureError("Failed to process the profile picture. Please try a different file.");
    }
  }

  async function handleSavePicture() {
    if (!uploadBlob) return;
    setPictureSaving(true);
    setPictureError(null);
    try {
      const formData = new FormData();
      formData.append("file", uploadBlob, "profile-picture.jpg");
      const response = await fetch("/api/profile/avatar", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setPictureError(data.error ?? "Failed to update profile picture.");
        return;
      }
      setAvatarUrl(data.avatar_url);
      closePicturePicker();
      router.refresh();
    } catch {
      setPictureError("Network error. Please try again.");
    } finally {
      setPictureSaving(false);
    }
  }

  function closePicturePicker() {
    setShowPicturePicker(false);
    setUploadBlob(null);
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setPictureError(null);
  }

  function handleRemoveUpload() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setUploadBlob(null);
  }

  return (
    <div className="mx-auto mt-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Your Profile</h1>
        <p className="mt-0.5 font-body text-sm text-foreground-muted">
          How you appear to others in the community
        </p>
      </div>

      <ProfileCard
        name={name}
        email={email}
        avatarUrl={avatarUrl}
        memberSince={memberSince}
        onOpenAvatarPicker={() => setShowPicturePicker(true)}
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

      {showPicturePicker && (
        <AvatarPickerModal
          uploadPreview={uploadPreview}
          saving={pictureSaving}
          error={pictureError}
          onFileSelect={handleFileSelect}
          onRemoveUpload={handleRemoveUpload}
          onSave={handleSavePicture}
          onClose={closePicturePicker}
        />
      )}
    </div>
  );
}
