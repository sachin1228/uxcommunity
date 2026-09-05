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
  referral:     { border: "#16A34A", text: "#4ADE80", bg: "rgba(22,163,74,0.10)"  },
  collaboration:{ border: "#0891B2", text: "#67E8F9", bg: "rgba(8,145,178,0.10)"  },
};

/**
 * Selected-state colors for choice chips (category + tags). Uses the design
 * system's Geist blue tokens so it adapts to light/dark automatically.
 */
export const BLUE_SELECTED_STYLE = {
  borderColor: "var(--ds-blue-700)",
  backgroundColor: "var(--ds-blue-100)",
  color: "var(--ds-blue-900)",
} as const;

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

/** Derive a title (≤ body max) from the composer body. */
export function bodyToTitle(body: string): string {
  const trimmed = body.trim();
  return trimmed.slice(0, THREAD_BODY_MAX_LENGTH) || "Thread";
}

/** A poll draft that has no content at all (question + every option blank). */
export function isPollDraftEmpty(draft: ThreadPollDraft): boolean {
  return !draft.question.trim() && draft.options.every((option) => !option.trim());
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
