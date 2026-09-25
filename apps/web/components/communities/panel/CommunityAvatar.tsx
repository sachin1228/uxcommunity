"use client";

import { CommunityDp } from "../CommunityDp";
import { DpWithEventDate } from "../DpWithEventDate";

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
  /**
   * An event group chat's own event date. Present → the DP wears a small
   * circular calendar badge, so the row says which day the room is for before
   * the member has to open it.
   */
  eventDate?: string | null;
  /**
   * That event's end (or its start when it has none), whether ahead or past —
   * what makes the badge say LIVE while the event runs and ENDED for the day
   * after it wraps.
   */
  eventEnd?: string | null;
  lottieUrl?: string | null;
  lottieFormat?: unknown;
  lottieData?: unknown;
}

export function CommunityAvatar({
  imageUrl,
  name,
  type,
  eventDate,
  eventEnd,
}: CommunityAvatarProps) {
  return (
    <DpWithEventDate date={eventDate} endsAt={eventEnd} dpSize={36}>
      <CommunityDp
        imageUrl={imageUrl}
        name={name}
        size={36}
        className="bg-surface-raised"
      />
    </DpWithEventDate>
  );
}
