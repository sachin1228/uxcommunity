"use client";

import { ExternalLink } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import type { AdminUser, UserApplication, UserInterest } from "./userTypes";
import { EXPERIENCE_LABELS, AVATAR_SOURCE_LABELS } from "./userTypes";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3.5 border-b border-border last:border-0">
      <span className="w-40 shrink-0 font-body text-sm text-foreground-muted">{label}</span>
      <span className="font-body text-sm text-foreground">{value}</span>
    </div>
  );
}

interface Props {
  user: AdminUser;
  application: UserApplication | null;
  interests: UserInterest[];
}

export function UserInfoCard({ user, application, interests }: Props) {
  const profile = user.designer_profiles;
  const avatarUrl = profile?.avatar_url;

  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-1">
      {/* Profile picture */}
      <InfoRow
        label="Profile picture"
        value={
          avatarUrl ? (
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-surface-raised">
                <AvatarImg
                  url={avatarUrl}
                  name={user.name}
                  size={40}
                  className="h-10 w-10 rounded-full object-cover"
                />
              </span>
              <span className="text-foreground-muted text-xs">
                {AVATAR_SOURCE_LABELS[profile?.avatar_source ?? ""] ??
                  profile?.avatar_source ??
                  ""}
              </span>
            </div>
          ) : (
            <span className="text-foreground-muted">No avatar set</span>
          )
        }
      />

      <InfoRow label="Email" value={user.email} />
      <InfoRow
        label="Joined"
        value={new Date(user.created_at).toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric",
        })}
      />
      <InfoRow label="Company" value={profile?.companies?.name ?? "—"} />
      <InfoRow label="City" value={profile?.cities?.name ?? "—"} />
      <InfoRow label="Industry Sector" value={profile?.design_sectors?.name ?? "—"} />
      <InfoRow
        label="Interests"
        value={
          interests.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {interests.map((i) => (
                <span
                  key={i.id}
                  className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 font-body text-xs text-accent"
                >
                  {i.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-foreground-muted">—</span>
          )
        }
      />
      <InfoRow
        label="Experience Level"
        value={
          EXPERIENCE_LABELS[profile?.experience_level ?? ""] ??
          profile?.experience_level ??
          "—"
        }
      />
      <InfoRow
        label="LinkedIn"
        value={
          application?.linkedin_url ? (
            <a
              href={application.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-accent hover:underline"
            >
              {application.linkedin_url}
              <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : (
            "—"
          )
        }
      />
      <InfoRow
        label="Portfolio"
        value={
          application?.portfolio_url ? (
            <a
              href={application.portfolio_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-accent hover:underline"
            >
              {application.portfolio_url}
              <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : (
            "—"
          )
        }
      />
    </div>
  );
}
