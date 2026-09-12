import { AvatarImg } from "@/components/ui/AvatarImg";
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
}: PostAuthorMetaProps) {
  const authorName = name ?? "Member";
  const relativeDate = dateLabel ?? formatRelativeDate(createdAt);
  const editedSuffix = edited ? " · edited" : "";

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <AvatarImg
        url={avatarUrl}
        name={authorName}
        size={40}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-body text-sm font-semibold text-foreground">
            {authorName}
          </span>
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
