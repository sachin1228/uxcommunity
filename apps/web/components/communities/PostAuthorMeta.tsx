import { formatRelativeDate } from "./threads/threadShared";

interface PostAuthorMetaProps {
  name?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  dateLabel?: string;
  secondaryLabel?: string;
  dateInline?: boolean;
  className?: string;
}

export function PostAuthorMeta({
  name,
  avatarUrl,
  createdAt,
  dateLabel,
  secondaryLabel,
  dateInline = false,
  className = "",
}: PostAuthorMetaProps) {
  const authorName = name ?? "Member";
  const authorInitial = authorName.charAt(0).toUpperCase();
  const relativeDate = dateLabel ?? formatRelativeDate(createdAt);

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15">
        {avatarUrl ? (
          <img src={avatarUrl} alt={authorName} className="h-full w-full object-cover" />
        ) : (
          <span className="font-display text-sm font-bold text-accent">{authorInitial}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-body text-[15px] font-semibold text-foreground">
            {authorName}
          </span>
          {dateInline && (
            <span className="shrink-0 font-body text-[11px] text-foreground-subtle">
              {relativeDate}
            </span>
          )}
        </div>
        {(secondaryLabel ?? (!dateInline ? relativeDate : null)) && (
          <span className="font-body text-[11px] text-foreground-subtle">
            {secondaryLabel ?? relativeDate}
          </span>
        )}
      </div>
    </div>
  );
}
