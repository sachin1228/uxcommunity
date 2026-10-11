"use client";

import { useRouter } from "next/navigation";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { EditProfileForm } from "@/components/profile/EditProfileForm";
import type { ProfileIdentityPayload } from "@/lib/profile/identity";

interface ProfileSectionProps {
  /** Current identity values, select options, groups and cooldown locks. */
  identity: ProfileIdentityPayload;
}

/**
 * Profile — the identity fields a member picked at signup (name, city,
 * industry sector, job title, experience level). This is where the profile
 * page's Edit Profile button lands: the hero stays a view, and every editable
 * detail lives here.
 *
 * The workplace has its own card beside this one (CompanySection) because it
 * is proved rather than typed. The form reports its own success inline; this
 * component only refreshes the page behind it (the sidebar and the hero) once
 * a save lands.
 */
export function ProfileSection({ identity }: ProfileSectionProps) {
  const router = useRouter();

  // An identity edit moves the member between official communities, so the
  // sidebar and explore caches are stale by definition — bust them, then let
  // the server render re-supply the page with the new values.
  function handleIdentitySaved() {
    invalidateCommunitiesList();
    router.refresh();
  }

  return (
    <section
      aria-labelledby="settings-profile-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <div>
        <h2 id="settings-profile-heading" className="font-display text-[15px] font-semibold text-foreground">
          Profile
        </h2>
        <p className="mt-0.5 font-body text-xs text-foreground-muted">
          Your name, role and city as they appear to everyone.
        </p>
      </div>

      <EditProfileForm data={identity} onSaved={handleIdentitySaved} />
    </section>
  );
}
