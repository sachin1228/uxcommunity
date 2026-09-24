interface CommunityPostLabelProps {
  communityId?: string;
  communityName: string;
  communityImage?: string | null;
  className?: string;
  /**
   * When provided, clicking the label calls this instead of navigating to the
   * community page — the homepage feed opens its non-member preview popup
   * here. Omitted on every other surface, which keeps the plain link.
   */
  onOpenPreview?: () => void;
}

export function CommunityPostLabel({
  communityId,
  communityName,
  communityImage,
  className = "",
  onOpenPreview,
}: CommunityPostLabelProps) {
  const content = (
    <div className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap font-body text-[11px] text-foreground-subtle ${className}`}>
      <span className="shrink-0">posted in</span>
      {communityImage ? (
        <img
          src={communityImage}
          alt={communityName}
          className="h-4 w-4 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full bg-accent/20" />
      )}
      <span className={`truncate ${onOpenPreview ? "transition-colors hover:text-foreground" : "text-foreground-muted"}`}>{communityName}</span>
    </div>
  );

  if (!communityId) return content;

  if (onOpenPreview) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenPreview();
        }}
        className="cursor-pointer text-left"
        aria-label={`Preview the ${communityName} community`}
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={`/dashboard/communities/${communityId}`}
      onClick={(e) => e.stopPropagation()}
      className="contents"
    >
      {content}
    </a>
  );
}
