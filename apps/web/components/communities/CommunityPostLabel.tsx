interface CommunityPostLabelProps {
  communityId?: string;
  communityName: string;
  communityImage?: string | null;
  className?: string;
}

export function CommunityPostLabel({
  communityId,
  communityName,
  communityImage,
  className = "",
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
      <span className="truncate text-foreground-muted">{communityName}</span>
    </div>
  );

  if (!communityId) return content;

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
