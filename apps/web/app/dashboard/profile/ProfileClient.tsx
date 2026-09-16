"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressAvatarClient, compressBannerClient } from "@/lib/image-client";
import { ProfileCard } from "./components/ProfileCard";
import { ImagePickerModal } from "./components/ImagePickerModal";
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
  bannerUrl: string | null;
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
  bannerUrl: initialBannerUrl,
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
  const [bannerUrl, setBannerUrl] = useState(initialBannerUrl);
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [showBannerPicker, setShowBannerPicker] = useState(false);
  const [bannerBlob, setBannerBlob] = useState<Blob | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerRemoving, setBannerRemoving] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const interestNames = allInterests
    .filter((i) => initialInterestIds.includes(i.id))
    .map((i) => i.name);

  useEffect(() => {
    return () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  useEffect(() => {
    return () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    };
  }, [bannerPreview]);

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

  async function handleBannerFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setBannerError(null);
    try {
      const compressed = await compressBannerClient(file);
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      setBannerBlob(compressed.blob);
      setBannerPreview(URL.createObjectURL(compressed.blob));
    } catch {
      setBannerError("Failed to process the banner image. Please try a different file.");
    }
  }

  async function handleSaveBanner() {
    if (!bannerBlob) return;
    setBannerSaving(true);
    setBannerError(null);
    try {
      const formData = new FormData();
      formData.append("file", bannerBlob, "profile-banner.webp");
      const response = await fetch("/api/profile/banner", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setBannerError(data.error ?? "Failed to update the banner.");
        return;
      }
      setBannerUrl(data.banner_url);
      closeBannerPicker();
      router.refresh();
    } catch {
      setBannerError("Network error. Please try again.");
    } finally {
      setBannerSaving(false);
    }
  }

  async function handleRemoveBanner() {
    setBannerRemoving(true);
    setBannerError(null);
    try {
      const response = await fetch("/api/profile/banner", { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setBannerError(data.error ?? "Failed to remove the banner.");
        return;
      }
      setBannerUrl(null);
      closeBannerPicker();
      router.refresh();
    } catch {
      setBannerError("Network error. Please try again.");
    } finally {
      setBannerRemoving(false);
    }
  }

  function closeBannerPicker() {
    setShowBannerPicker(false);
    setBannerBlob(null);
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(null);
    setBannerError(null);
  }

  function handleRemoveBannerUpload() {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(null);
    setBannerBlob(null);
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
          bannerUrl={bannerUrl}
          onOpenAvatarPicker={() => setShowPicturePicker(true)}
          onOpenBannerPicker={() => setShowBannerPicker(true)}
          city={city}
          sector={sector}
          experienceLevel={experienceLevel}
          jobTitle={jobTitle}
          bio={initialBio}
          interestNames={interestNames}
          postCount={postCount}
        />
      </div>

      <ProfileActivityFeed currentUserId={userId} initialTab={initialTab} basePath="/dashboard/profile" />

      {showPicturePicker && (
        <ImagePickerModal
          variant="avatar"
          uploadPreview={uploadPreview}
          saving={pictureSaving}
          error={pictureError}
          onFileSelect={handleFileSelect}
          onRemoveUpload={handleRemoveUpload}
          onSave={handleSavePicture}
          onClose={closePicturePicker}
        />
      )}

      {showBannerPicker && (
        <ImagePickerModal
          variant="banner"
          uploadPreview={bannerPreview}
          saving={bannerSaving}
          error={bannerError}
          onFileSelect={handleBannerFileSelect}
          onRemoveUpload={handleRemoveBannerUpload}
          onSave={handleSaveBanner}
          onClose={closeBannerPicker}
          existingUrl={bannerUrl}
          onRemoveExisting={handleRemoveBanner}
          removing={bannerRemoving}
        />
      )}
    </div>
  );
}
