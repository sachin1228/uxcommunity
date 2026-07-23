import type { ModerationStatus } from "./types";

export interface KeywordRule {
  category: string;
  action: ModerationStatus;
  terms: string[];
}

export interface ModerationConfig {
  text: {
    maxLength: number;
    rateLimits: Array<{ limit: number; windowS: number }>;
    repeatedCharacterLimit: number;
    repeatedLinkLimit: number;
    repeatedHashtagLimit: number;
    duplicateWindowS: number;
    profanityRejectThreshold: number;
    profanityReviewThreshold: number;
  };
  images: {
    maxBytes: number;
    allowedMimeTypes: string[];
    serviceUrl?: string;
    timeoutMs: number;
  };
  keywords: KeywordRule[];
  profanity: string[];
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseListEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getModerationConfig(): ModerationConfig {
  const customReject = parseListEnv("MODERATION_REJECT_KEYWORDS");
  const customReview = parseListEnv("MODERATION_REVIEW_KEYWORDS");
  const customProfanity = parseListEnv("MODERATION_PROFANITY_WORDS");

  return {
    text: {
      maxLength: parseIntEnv("MODERATION_TEXT_MAX_LENGTH", 2000),
      rateLimits: [
        { limit: parseIntEnv("MODERATION_TEXT_BURST_LIMIT", 5), windowS: 10 },
        { limit: parseIntEnv("MODERATION_TEXT_MINUTE_LIMIT", 20), windowS: 60 },
      ],
      repeatedCharacterLimit: 12,
      repeatedLinkLimit: 2,
      repeatedHashtagLimit: 8,
      duplicateWindowS: 120,
      profanityRejectThreshold: 0.92,
      profanityReviewThreshold: 0.72,
    },
    images: {
      maxBytes: parseIntEnv("MODERATION_IMAGE_MAX_BYTES", 20 * 1024 * 1024),
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      serviceUrl: process.env.MODERATION_IMAGE_SERVICE_URL,
      timeoutMs: parseIntEnv("MODERATION_IMAGE_TIMEOUT_MS", 8000),
    },
    keywords: [
      {
        category: "sexual",
        action: "rejected",
        terms: ["porn", "hardcore sex", "escort service", "cam girl"],
      },
      {
        category: "harassment",
        action: "rejected",
        terms: ["kill yourself", "go die", "worthless trash"],
      },
      {
        category: "threats",
        action: "rejected",
        terms: ["i will kill you", "i will hurt you", "bomb threat"],
      },
      {
        category: "violence",
        action: "review",
        terms: ["graphic violence", "bloodbath", "massacre"],
      },
      {
        category: "self_harm",
        action: "review",
        terms: ["self harm", "suicide method", "want to die"],
      },
      {
        category: "scams",
        action: "rejected",
        terms: ["guaranteed profit", "double your money", "risk free investment"],
      },
      {
        category: "spam",
        action: "rejected",
        terms: ["free followers", "click here now", "limited time offer"],
      },
      {
        category: "drugs",
        action: "review",
        terms: ["buy cocaine", "buy mdma", "darknet pills"],
      },
      {
        category: "weapons",
        action: "review",
        terms: ["buy gun no license", "ghost gun", "3d printed gun"],
      },
      ...customReject.map((term) => ({ category: "custom", action: "rejected" as const, terms: [term] })),
      ...customReview.map((term) => ({ category: "custom", action: "review" as const, terms: [term] })),
    ],
    profanity: [
      "fuck",
      "shit",
      "bitch",
      "asshole",
      "bastard",
      "cunt",
      "dick",
      ...customProfanity,
    ],
  };
}
