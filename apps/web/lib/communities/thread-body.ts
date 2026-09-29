/**
 * The thread create/edit request body contract.
 *
 * WHY THIS EXISTS
 *   Creating a thread (`POST /api/communities/[id]/threads`) and editing one
 *   (`PATCH /api/communities/[id]/threads/[threadId]`) must accept exactly the
 *   same body — a thread that can be created must be editable, and vice versa.
 *   Those rules were implemented twice, copy-pasted between the two route files:
 *   the same category list, the same five limits, and four separate normalizers
 *   (`poll`, `tags`, `links`, `attachments`). Two copies of one contract is a
 *   drift waiting to happen: a field validated on the way in but not on the way
 *   out leaves an unreadable row behind.
 *
 *   The limits themselves already lived in ./models/threads.ts; this module is
 *   the request-side half — it answers "is this body well-formed?" and returns
 *   the normalized value (or null). It reuses the model's constants rather than
 *   restating them.
 *
 * WHAT IT IS NOT
 *   It does not touch the database, does not decide who may write, and does not
 *   shape responses. Invalid input is `null`, and each route keeps its own error
 *   status and message — the messages are identical today, but they are the
 *   route's business, not this module's.
 */

import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  THREAD_CATEGORIES,
  type ThreadAttachment,
} from "./models/threads";

/** Category values a thread may be created with — the model's list, as a set. */
export const THREAD_CATEGORY_VALUES: ReadonlySet<string> = new Set(
  THREAD_CATEGORIES.map((category) => category.value),
);

interface RawAttachment {
  name?: unknown;
  url?: unknown;
  type?: unknown;
  size?: unknown;
}

interface RawPoll {
  question?: unknown;
  options?: unknown;
}

/**
 * Validate an optional poll payload.
 * Returns { poll: null } when absent, the normalized poll when present,
 * or null when the shape is invalid.
 *
 * The poll is typed as an object literal rather than as the model's
 * `ThreadPoll` on purpose: only object *type aliases* get an implicit index
 * signature, which is what makes the result assignable to the `Json` column it
 * is persisted into (the same reason `ThreadAttachment` is an alias — see
 * ./models/threads.ts).
 */
export function normalizePoll(value: unknown): { poll: { question: string; options: string[] } | null } | null {
  if (value == null) return { poll: null };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const { question: rawQuestion, options: rawOptions } = value as RawPoll;
  if (typeof rawQuestion !== "string") return null;
  const question = rawQuestion.trim();
  if (!question || question.length > POLL_QUESTION_MAX_LENGTH) return null;
  if (!Array.isArray(rawOptions)) return null;
  const options = rawOptions.filter((option): option is string => typeof option === "string").map((option) => option.trim());
  if (options.length !== rawOptions.length) return null;
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) return null;
  if (options.some((option) => !option || option.length > POLL_OPTION_MAX_LENGTH)) return null;
  if (new Set(options).size !== options.length) return null;
  return { poll: { question, options } };
}

export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length !== value.length || tags.some((tag) => tag.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

export function normalizeLinks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const links = value.filter((link): link is string => typeof link === "string").map((link) => link.trim());
  if (links.length !== value.length) return null;
  for (const link of links) {
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol)) return null;
    } catch {
      return null;
    }
  }
  return [...new Set(links)];
}

export function normalizeAttachments(value: unknown): ThreadAttachment[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const attachments: ThreadAttachment[] = [];
  for (const item of value as RawAttachment[]) {
    if (
      typeof item.name !== "string" ||
      typeof item.url !== "string" ||
      typeof item.type !== "string" ||
      typeof item.size !== "number" ||
      item.name.length > 255 ||
      item.url.length > 2048 ||
      item.type.length > 100 ||
      item.size < 0
    ) {
      return null;
    }
    attachments.push({
      name: item.name,
      url: item.url,
      type: item.type,
      size: item.size,
    });
  }
  return attachments;
}
