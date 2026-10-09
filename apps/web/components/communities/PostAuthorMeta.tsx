import Link from "next/link";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { profileHref } from "@/lib/profile/links";
import { formatRelativeDate } from "./threads/threadShared";

interface PostAuthorMetaProps {
  name?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  dateLabel?: string;
  secondaryLabel?: string;
  dateInline?: boolean;
  /** When true, appends an "· edited" marker to the date (edited posts/polls). */
  edited?: boolean;
  className?: string;
  /** When set, the avatar and name open the author's profile. */
  userId?: string | null;
}

export function PostAuthorMeta({
  name,
  avatarUrl,
  createdAt,
  dateLabel,
  secondaryLabel,
  dateInline = false,
  edited = false,
  className = "",
  userId,
}: PostAuthorMetaProps) {
  const authorName = name ?? "Member";
  const relativeDate = dateLabel ?? formatRelativeDate(createdAt);
  const editedSuffix = edited ? " · edited" : "";
  const href = userId ? profileHref(userId) : null;

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      {href ? (
        <Link
          href={href}
          title={authorName}
          className="shrink-0 rounded-full transition-opacity hover:opacity-85"
        >
          <AvatarImg
            url={avatarUrl}
            name={authorName}
            size={40}
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        </Link>
      ) : (
        <AvatarImg
          url={avatarUrl}
          name={authorName}
          size={40}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      )}
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          {href ? (
            <Link
              href={href}
              className="truncate font-body text-sm font-semibold text-foreground hover:underline"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate font-body text-sm font-semibold text-foreground">
              {authorName}
            </span>
          )}
          {dateInline && (
            <span className="shrink-0 font-body text-[11px] font-semibold text-foreground-subtle">
              {relativeDate}{editedSuffix}
            </span>
          )}
        </div>
        {(secondaryLabel ?? (!dateInline ? relativeDate : null)) && (
          <span className="font-body text-[11px] text-foreground-subtle font-semibold">
            {secondaryLabel ?? relativeDate + editedSuffix}
          </span>
        )}
      </div>
    </div>
  );
}
