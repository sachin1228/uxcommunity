import type { CachedMessage, MessageMention, ReplyPreview } from "@/lib/communities/cache";

export type SetMessages = React.Dispatch<React.SetStateAction<CachedMessage[]>>;

export interface UseSendMessageOptions {
  communityId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  setMessages: SetMessages;
  setHideUnreadDivider: (val: boolean) => void;
  replyTo: ReplyPreview | null;
  onClearReply: () => void;
  /** The chat's scrollable message body — pinned to the newest message on every send. */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Resolves the members @mentioned in the final text (composer registry). */
  resolveMentions?: (content: string) => MessageMention[];
}

export type RetryData = {
  file: File | null;
  content: string;
  replyTo: ReplyPreview | null;
};

/** Everything one send needs — shared by the composer, retry and GIF paths. */
export type SendArgs = {
  content: string;
  imageFile: File | null;
  imagePreviewUrl: string | null;
  replyTo: ReplyPreview | null;
  tempId: string;
};

export type SendResult = { sentCommunityId: string | null; message: CachedMessage | null };

/**
 * The per-render values and shared mutable maps a send pipeline needs. Built
 * fresh by the hook each render, so a pipeline sees the render it started in.
 */
export interface SendContext {
  communityId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  setMessages: SetMessages;
  setHideUnreadDivider: (val: boolean) => void;
  setError: (error: string | null) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /** One AbortController per in-flight send, keyed by temp id. */
  abortControllers: Map<string, AbortController>;
  /** Payloads of failed sends, keyed by temp id, so they can be retried. */
  failedRetryData: Map<string, RetryData>;
  resolveMentionsFor: (content: string) => MessageMention[];
}
