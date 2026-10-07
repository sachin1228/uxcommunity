"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressAvatarClient } from "@/lib/image-client";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { ProfileCard } from "./components/ProfileCard";
import { ImagePickerModal } from "./components/ImagePickerModal";
import { EditProfileModal } from "./components/EditProfileModal";
import { ProfileActivityFeed } from "@/components/feeds/ProfileActivityFeed";
import type { ProfileActivityTab } from "@/components/feeds/ProfileActivityFeed";
import { AddCompanyModal } from "@/components/companies/AddCompanyModal";
import type { ProfileIdentityPayload } from "@/lib/profile/identity";
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
  /** Current identity values, select options, groups and cooldown locks
   *  for the Edit Profile modal. */
  identity: ProfileIdentityPayload;
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
  identity,
}: Props) {
  const router = useRouter();
  // The server is the source of truth: the client only mirrors what the last
  // read returned, and refreshes the page after a membership changes.
  //
  // `initialName` is read straight from that render — nothing on this screen
  // edits it, and a copy in state would keep the first render's value forever,
  // including an empty one, which reads as a nameless hero.
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [removingCompany, setRemovingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(pendingCompany);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);

  // A newer server render (a refresh, a navigation) supersedes whatever an
  // upload left in state. Adjusted during render — an effect would re-render a
  // second time for props it already has.
  const [serverAvatarUrl, setServerAvatarUrl] = useState(initialAvatarUrl);
  if (serverAvatarUrl !== initialAvatarUrl) {
    setServerAvatarUrl(initialAvatarUrl);
    setAvatarUrl(initialAvatarUrl);
  }
  const [showPicturePicker, setShowPicturePicker] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
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

  // The hero owns the company card, so it also owns taking the company away:
  // the picker covers adding and changing, and nothing else deletes a
  // membership since Settings stopped carrying the Work section.
  async function handleRemoveCompany() {
    setRemovingCompany(true);
    setCompanyError(null);
    try {
      const response = await fetch("/api/companies/membership", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setCompanyError(data.message ?? "Couldn't remove the company. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setCompanyError("Network error. Please try again.");
    } finally {
      setRemovingCompany(false);
    }
  }

  function handleRemoveUpload() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setUploadBlob(null);
  }

  // An identity edit moves the member between official communities, so the
  // sidebar and explore caches are stale by definition — bust them, then let
  // the server render re-supply this card with the new name/city/sector.
  function handleIdentitySaved() {
    invalidateCommunitiesList();
    router.refresh();
  }

  return (
    <div className="relative min-h-full">
      {/* Full-bleed dotted backdrop for the page: the texture belongs to the
          page, not to a card, so the hero sits directly on it. It is masked to
          fade out down the page, so the dots open the page and then vanish. */}
      <div className="grid-dots grid-dots-fade pointer-events-none absolute inset-0" aria-hidden="true" />

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
            sector={sector}
            roleLabel={roleLabel}
            bio={initialBio}
            interestNames={interestNames}
            company={initialCompany}
            onEditCompany={() => {
              setCompanyError(null);
              setShowCompanyPicker(true);
            }}
            onRemoveCompany={handleRemoveCompany}
            removingCompany={removingCompany}
            companyError={companyError}
            onOpenEditProfile={() => setShowEditProfile(true)}
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

      {/* Mounted only while open: the draft (fields, step, error) is
          per-attempt state, so unmounting is what resets it. */}
      {showEditProfile && (
        <EditProfileModal
          open
          data={identity}
          onClose={() => setShowEditProfile(false)}
          onSaved={handleIdentitySaved}
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
