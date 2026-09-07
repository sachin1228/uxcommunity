import type { ThreadPollDraft, ThreadPoll } from "./types";
import {
  POLL_MIN_OPTIONS,
  THREAD_BODY_MAX_LENGTH,
} from "./types";

/** Shared constants and helpers for thread card rendering. */

export const CATEGORY_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  question:     { border: "#7C3AED", text: "#A78BFA", bg: "rgba(124,58,237,0.10)" },
  discussion:   { border: "#737373", text: "#E5E5E5", bg: "rgba(255,255,255,0.08)" },
  idea:         { border: "#D97706", text: "#FCD34D", bg: "rgba(217,119,6,0.10)"  },
  feedback:     { border: "#EA580C", text: "#FB923C", bg: "rgba(234,88,12,0.10)"  },
};

export function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatFullDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Whether a thread has been edited since it was created. The DB trigger
 * bumps `updated_at` on every update while `created_at` stays fixed, so an
 * edited thread is one whose `updated_at` is meaningfully newer (a small
 * tolerance guards against timestamp serialization noise).
 */
export function isThreadEdited(createdAt: string, updatedAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  return updated - created > 1_000;
}

/** Derive a title (≤ body max) from the composer body. */
export function bodyToTitle(body: string): string {
  const trimmed = body.trim();
  return trimmed.slice(0, THREAD_BODY_MAX_LENGTH) || "Thread";
}

/** Human-readable validation message for an incomplete poll draft. */
export function validatePollDraft(draft: ThreadPollDraft): string | null {
  if (!draft.question.trim()) return "Add a question for your poll.";
  const filled = draft.options.filter((option) => option.trim());
  if (filled.length < POLL_MIN_OPTIONS) {
    return `Add at least ${POLL_MIN_OPTIONS} options to your poll.`;
  }
  return null;
}

/** Trim + serialize a validated draft into the stored poll shape. */
export function serializePollDraft(draft: ThreadPollDraft): ThreadPoll {
  return {
    question: draft.question.trim(),
    options: draft.options.map((option) => option.trim()).filter(Boolean),
  };
}
