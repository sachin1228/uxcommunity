import { CommunityDp } from "./CommunityDp";

interface CommunityPostLabelProps {
  communityId?: string;
  communityName: string;
  communityImage?: string | null;
  className?: string;
  /**
   * When provided, clicking the label calls this instead of navigating to the
   * community page — the home feed and the profile activity tabs open their
   * non-member preview popup here. Omitted elsewhere, which keeps the plain
   * link.
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
      <CommunityDp imageUrl={communityImage ?? null} name={communityName} size={16} iconSize={9} />
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
