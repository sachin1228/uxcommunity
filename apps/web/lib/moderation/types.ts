export type ModerationStatus = "approved" | "review" | "rejected";

export type ModerationContentType =
  | "chat_message"
  | "post"
  | "comment"
  | "username"
  | "user_bio"
  | "community_name"
  | "image_upload";

export interface RuleHit {
  rule: string;
  category: string;
  action: ModerationStatus;
  confidence: number;
  detail?: string;
}

export interface ModerationDecision {
  status: ModerationStatus;
  allowed: boolean;
  reason: string;
  provider: string;
  confidence: number;
  triggered_rules: RuleHit[];
  scores: Record<string, number>;
  duration_ms: number;
}

export interface TextModerationInput {
  content: string;
  contentType: ModerationContentType;
  userId?: string;
  requestId?: string;
}

export interface ImageModerationInput {
  file: File | Blob;
  contentType: ModerationContentType;
  userId?: string;
  requestId?: string;
}

export interface ModerationLogInput {
  userId?: string | null;
  contentType: ModerationContentType;
  contentRefId?: string | null;
  contentHash?: string | null;
  decision: ModerationDecision;
}
