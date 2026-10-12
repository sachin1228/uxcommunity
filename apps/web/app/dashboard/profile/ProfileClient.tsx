"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressAvatarClient } from "@/lib/image-client";
import { DotField } from "@/components/ui/DotField";
import { ProfileCard } from "./components/ProfileCard";
import { ImagePickerModal } from "./components/ImagePickerModal";
import { AddLinkModal } from "./components/AddLinkModal";
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
  /** Seniority plus designation for the pill beside the name. */
  roleLabel: string | null;
  initialLinkedIn: string;
  initialPortfolio: string;
  initialBio: string;
  initialCompany: ProfileCompanyView | null;
  pendingCompany: PendingCompanyVerification | null;
}

export function ProfileClient({
  userId,
  initialTab,
  initialName,
  avatarUrl: initialAvatarUrl,
  city,
  roleLabel,
  initialBio,
  initialCompany,
  pendingCompany,
  initialLinkedIn,
  initialPortfolio,
}: Props) {
  const router = useRouter();
  // The server is the source of truth: the client only mirrors what the last
  // read returned, and refreshes the page after a picture change or a company
  // is verified.
  //
  // `initialName` is read straight from that render — nothing on this screen
  // edits it, and a copy in state would keep the first render's value forever,
  // including an empty one, which reads as a nameless hero.
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(pendingCompany);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedIn);
  const [portfolioUrl, setPortfolioUrl] = useState(initialPortfolio);
  const [linkModal, setLinkModal] = useState<"linkedin" | "portfolio" | null>(null);

  // A newer server render (a refresh, a navigation) supersedes whatever an
  // upload left in state. Adjusted during render — an effect would re-render a
  // second time for props it already has.
  const [serverAvatarUrl, setServerAvatarUrl] = useState(initialAvatarUrl);
  if (serverAvatarUrl !== initialAvatarUrl) {
    setServerAvatarUrl(initialAvatarUrl);
    setAvatarUrl(initialAvatarUrl);
  }
  const [serverLinkedInUrl, setServerLinkedInUrl] = useState(initialLinkedIn);
  if (serverLinkedInUrl !== initialLinkedIn) {
    setServerLinkedInUrl(initialLinkedIn);
    setLinkedinUrl(initialLinkedIn);
  }
  const [serverPortfolioUrl, setServerPortfolioUrl] = useState(initialPortfolio);
  if (serverPortfolioUrl !== initialPortfolio) {
    setServerPortfolioUrl(initialPortfolio);
    setPortfolioUrl(initialPortfolio);
  }
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

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
          page, not to a card, so the hero sits directly on it. DotField owns
          the dot lattice — it fades out down the page and stirs under the
          pointer without leaving the page. */}
      <DotField />

      {/* The display picture leads the page with open space above it, the way
          the reference pane opens. The title stays in the document outline and
          keeps naming the browser tab (see `page.tsx` metadata). */}
      <div className="relative mx-auto max-w-3xl px-4 pt-24 pb-12 lg:px-6">
        <h1 className="sr-only">Your Profile</h1>

        <div className="mb-6">
          <ProfileCard
            name={initialName}
            avatarUrl={avatarUrl}
            onOpenAvatarPicker={() => setShowPicturePicker(true)}
            city={city}
            roleLabel={roleLabel}
            bio={initialBio}
            company={initialCompany}
            onAddCompany={() => setShowCompanyPicker(true)}
            editProfileHref="/dashboard/settings/profile"
            portfolio={portfolioUrl}
            onAddPortfolio={() => setLinkModal("portfolio")}
            linkedinUrl={linkedinUrl}
            onAddLinkedIn={() => setLinkModal("linkedin")}
          />
        </div>

        <ProfileActivityFeed currentUserId={userId} initialTab={initialTab} basePath="/dashboard/profile" />
      </div>

      {showPicturePicker && (
        <ImagePickerModal
          uploadPreview={uploadPreview}
          saving={pictureSaving}
          error={pictureError}
          onFileSelect={handleFileSelect}
          onRemoveUpload={handleRemoveUpload}
          onSave={handleSavePicture}
          onClose={closePicturePicker}
        />
      )}

      {linkModal && (
        <AddLinkModal
          kind={linkModal}
          initialUrl={linkModal === "linkedin" ? linkedinUrl : portfolioUrl}
          onClose={() => setLinkModal(null)}
          onSaved={(url) => {
            if (linkModal === "linkedin") setLinkedinUrl(url);
            else setPortfolioUrl(url);
            setLinkModal(null);
            router.refresh();
          }}
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
