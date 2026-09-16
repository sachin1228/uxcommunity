"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressAvatarClient } from "@/lib/image-client";
import { ProfileCard } from "./components/ProfileCard";
import { AvatarPickerModal } from "./components/AvatarPickerModal";
import { ProfileActivityFeed } from "@/components/feeds/ProfileActivityFeed";
import type { ProfileActivityTab } from "@/components/feeds/ProfileActivityFeed";

interface Props {
  userId: string;
  initialTab: ProfileActivityTab;
  initialName: string;
  email: string;
  createdAt: string;
  avatarUrl: string | null;
  avatarSource: string | null;
  city: string | null;
  sector: string | null;
  experienceLevel: string | null;
  jobTitle: string | null;
  initialLinkedIn: string;
  initialPortfolio: string;
  initialBio: string;
  initialInterestIds: string[];
  allInterests: { id: string; name: string; image_url?: string | null }[];
  postCount: number;
}

export function ProfileClient({
  userId,
  initialTab,
  initialName,
  avatarUrl: initialAvatarUrl,
  city,
  sector,
  experienceLevel,
  jobTitle,
  initialBio,
  initialInterestIds,
  allInterests,
  postCount,
}: Props) {
  const router = useRouter();
  const [name] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [interestIds, setInterestIds] = useState<string[]>(initialInterestIds);
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  const interestNames = allInterests
    .filter((i) => interestIds.includes(i.id))
    .map((i) => i.name);

  async function handleSaveInterests(nextIds: string[]) {
    // Optimistic: flip the chips right away, roll back if the save fails.
    const previous = interestIds;
    setInterestIds(nextIds);
    try {
      const res = await fetch("/api/profile/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interest_ids: nextIds }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setInterestIds(previous);
    }
  }

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
      const compressed = await compressAvatarClient(file);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadBlob(compressed.blob);
      setUploadPreview(URL.createObjectURL(compressed.blob));
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
      formData.append("file", uploadBlob, "profile-picture.webp");
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

      <div className="mb-6">
        <ProfileCard
          name={name}
          avatarUrl={avatarUrl}
          onOpenAvatarPicker={() => setShowPicturePicker(true)}
          city={city}
          sector={sector}
          experienceLevel={experienceLevel}
          jobTitle={jobTitle}
          bio={initialBio}
          interestNames={interestNames}
          allInterests={allInterests}
          onSaveInterests={handleSaveInterests}
          postCount={postCount}
        />
      </div>

      <ProfileActivityFeed currentUserId={userId} initialTab={initialTab} basePath="/dashboard/profile" />

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
