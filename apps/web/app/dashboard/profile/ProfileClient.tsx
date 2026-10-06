"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressAvatarClient } from "@/lib/image-client";
import { ProfileCard } from "./components/ProfileCard";
import { ImagePickerModal } from "./components/ImagePickerModal";
import { ProfileActivityFeed } from "@/components/feeds/ProfileActivityFeed";
import type { ProfileActivityTab } from "@/components/feeds/ProfileActivityFeed";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import type {
  PendingCompanyVerification,
  ProfileCompanyView,
} from "@/components/companies/types";

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
  /** Seniority plus designation for the pill beside the name. */
  roleLabel: string | null;
  initialLinkedIn: string;
  initialPortfolio: string;
  initialBio: string;
  initialInterestIds: string[];
  allInterests: { id: string; name: string; image_url?: string | null }[];
  initialCompany: ProfileCompanyView | null;
  pendingCompany: PendingCompanyVerification | null;
}

export function ProfileClient({
  userId,
  initialTab,
  initialName,
  avatarUrl: initialAvatarUrl,
  city,
  sector,
  roleLabel,
  initialBio,
  initialInterestIds,
  allInterests,
  initialCompany,
  pendingCompany,
}: Props) {
  const router = useRouter();
  const [name] = useState(initialName);
  // The server is the source of truth: the client only mirrors what the last
  // read returned, and refreshes the page after a membership changes.
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(pendingCompany);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  const interestNames = allInterests
    .filter((i) => initialInterestIds.includes(i.id))
    .map((i) => i.name);

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
    <div className="relative min-h-full">
      {/* Full-bleed dotted backdrop for the page: the texture belongs to the
          page, not to a card, so the hero and the feed sit directly on it. */}
      <div className="grid-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />

      <div className="relative mx-auto max-w-3xl px-4 py-8 lg:px-6">
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
            roleLabel={roleLabel}
            bio={initialBio}
            interestNames={interestNames}
            company={initialCompany}
            onAddCompany={() => setShowCompanyPicker(true)}
          />
        </div>

        <ProfileActivityFeed currentUserId={userId} initialTab={initialTab} basePath="/dashboard/profile" />
      </div>

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

      {/* Mounted only while open: the picker's state is per-attempt, so
          unmounting it is what resets the search, the email and the code. */}
      {showCompanyPicker && (
        <AddCompanyModal
          open
          onClose={() => setShowCompanyPicker(false)}
          initialPending={pendingVerification}
          onVerified={() => {
            setPendingVerification(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
