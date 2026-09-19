/**
 * Competition body validation.
 *
 * The same entry parser serves create (POST) and edit (PATCH) so a submission
 * can never be more permissive on one path than the other, and the admin
 * parser keeps the weekly cycle windows honest.
 *
 * URLs are only accepted when they point at our own media bucket (uploads) or
 * an https link (Figma / prototype / any externally hosted image), which stops
 * an entry from injecting `javascript:` or data URLs into the gallery.
 */

import { COMPETITION_DIFFICULTIES, type CompetitionDifficulty } from "./cycle";
import {
  DEFAULT_COMPETITION_RULES,
  DEFAULT_VOTING_RULES,
  type CompetitionBrief,
  type CompetitionEntryImage,
  type CompetitionVotingRules,
} from "./types";

export const ENTRY_TITLE_MAX = 120;
export const ENTRY_DESCRIPTION_MAX = 2000;
export const ENTRY_IMAGES_MAX = 6;
export const ENTRY_TOOLS_MAX = 10;
export const ENTRY_TAGS_MAX = 8;
export const COMMENT_MAX = 1000;
export const RULES_MAX = 12;
export const RULE_MAX = 200;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false;
  return /^https:\/\/[^\s]+$/i.test(value);
}

/** Figma and prototype links: https only, and never a bare "https://". */
function parseExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isHttpsUrl(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseStringList(value: unknown, max: number, itemMax: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || text.length > itemMax) return null;
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  return out;
}

function parseImages(value: unknown): CompetitionEntryImage[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ENTRY_IMAGES_MAX) return null;
  const images: CompetitionEntryImage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const type = typeof record.type === "string" ? record.type : "image/jpeg";
    const name = typeof record.name === "string" ? record.name.slice(0, 255) : "Design image";
    const size =
      typeof record.size === "number" && Number.isFinite(record.size) ? Math.round(record.size) : 0;
    if (!isHttpsUrl(url)) return null;
    if (!IMAGE_TYPES.has(type)) return null;
    images.push({ name, url, type, size });
  }
  return images;
}

export interface CompetitionEntryInput {
  title: string;
  description: string;
  coverImageUrl: string;
  designImageUrl: string;
  imageUrls: CompetitionEntryImage[];
  figmaUrl: string | null;
  prototypeUrl: string | null;
  tools: string[];
  tags: string[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Entry body. `title` is the only required human input; the design image is
 * required because an entry without artwork is not an entry.
 */
export function parseCompetitionEntryBody(
  body: Record<string, unknown>,
  options: { requireDesigns: boolean },
): ParseResult<CompetitionEntryInput> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 3 || title.length > ENTRY_TITLE_MAX) {
    return { ok: false, error: `Add a title between 3 and ${ENTRY_TITLE_MAX} characters.` };
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > ENTRY_DESCRIPTION_MAX) {
    return { ok: false, error: `Keep the description under ${ENTRY_DESCRIPTION_MAX} characters.` };
  }

  const designImageUrl = typeof body.design_image_url === "string" ? body.design_image_url.trim() : "";
  if (options.requireDesigns && !isHttpsUrl(designImageUrl)) {
    return { ok: false, error: "Upload the main design image." };
  }
  if (designImageUrl && !isHttpsUrl(designImageUrl)) {
    return { ok: false, error: "Invalid design image URL." };
  }

  const coverImageUrl =
    (typeof body.cover_image_url === "string" ? body.cover_image_url.trim() : "") || designImageUrl;
  if (!isHttpsUrl(coverImageUrl)) {
    return { ok: false, error: "Upload a cover image." };
  }

  const images = parseImages(body.image_urls);
  if (!images) return { ok: false, error: `You can add up to ${ENTRY_IMAGES_MAX} extra images.` };

  const tools = parseStringList(body.tools, ENTRY_TOOLS_MAX, 30);
  if (!tools) return { ok: false, error: `List up to ${ENTRY_TOOLS_MAX} design tools.` };

  const tags = parseStringList(body.tags, ENTRY_TAGS_MAX, 24);
  if (!tags) return { ok: false, error: `Add up to ${ENTRY_TAGS_MAX} tags.` };

  return {
    ok: true,
    value: {
      title,
      description,
      coverImageUrl,
      designImageUrl: designImageUrl || coverImageUrl,
      imageUrls: images,
      figmaUrl: parseExternalUrl(body.figma_url),
      prototypeUrl: parseExternalUrl(body.prototype_url),
      tools,
      tags,
    },
  };
}

/** Vote toggle body: `{ active: boolean }`. */
export function parseVoteBody(body: Record<string, unknown>): ParseResult<{ active: boolean }> {
  if (typeof body.active !== "boolean") return { ok: false, error: "Invalid vote action." };
  return { ok: true, value: { active: body.active } };
}

/** Comment body: `{ body: string, parent_id?: string }`. */
export function parseCommentBody(
  body: Record<string, unknown>,
): ParseResult<{ body: string; parentId: string | null }> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text || text.length > COMMENT_MAX) {
    return { ok: false, error: `Comment must be 1–${COMMENT_MAX} characters.` };
  }
  const parentId = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;
  return { ok: true, value: { body: text, parentId } };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface CompetitionUpsertInput {
  slug: string;
  weekNumber: number;
  title: string;
  description: string;
  brief: CompetitionBrief;
  rules: string[];
  category: string;
  difficulty: CompetitionDifficulty;
  coverImageUrl: string | null;
  startAt: string;
  submissionDeadline: string;
  votingDeadline: string;
  resultsAt: string;
  archivedAt: string | null;
  maxEntriesPerUser: number;
  votingRules: CompetitionVotingRules;
}

export function slugifyCompetitionTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseBrief(value: unknown): CompetitionBrief {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string).trim() : "");
  return {
    problem: text("problem"),
    challenge: text("challenge"),
    deliverable: text("deliverable"),
    dimensions: text("dimensions"),
    judging: text("judging"),
  };
}

function parseRules(value: unknown): string[] {
  if (value === undefined) return DEFAULT_COMPETITION_RULES;
  if (!Array.isArray(value) || value.length > RULES_MAX) return DEFAULT_COMPETITION_RULES;
  const rules = value
    .map((rule) => (typeof rule === "string" ? rule.trim() : ""))
    .filter((rule) => rule && rule.length <= RULE_MAX);
  return rules.length ? rules : DEFAULT_COMPETITION_RULES;
}

export function parseVotingRules(value: unknown): CompetitionVotingRules {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const flag = (key: keyof CompetitionVotingRules) =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : DEFAULT_VOTING_RULES[key];
  const rules: CompetitionVotingRules = {
    one_vote_per_entry: flag("one_vote_per_entry"),
    allow_self_vote: flag("allow_self_vote"),
    allow_vote_removal: flag("allow_vote_removal"),
    show_live_leaderboard: flag("show_live_leaderboard"),
  };
  // The MVP is explicitly one-vote-per-entry; a per-entry budget is the only
  // mode the API implements, so anything else is coerced back to it.
  rules.one_vote_per_entry = true;
  return rules;
}

export function parseCompetitionUpsertBody(
  body: Record<string, unknown>,
): ParseResult<CompetitionUpsertInput> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 3 || title.length > 140) {
    return { ok: false, error: "Give the challenge a title between 3 and 140 characters." };
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 600) {
    return { ok: false, error: "Keep the description under 600 characters." };
  }

  const difficultyRaw = typeof body.difficulty === "string" ? body.difficulty : "intermediate";
  if (!(COMPETITION_DIFFICULTIES as readonly string[]).includes(difficultyRaw)) {
    return { ok: false, error: "Pick a difficulty of beginner, intermediate or advanced." };
  }

  const weekNumber =
    typeof body.week_number === "number" && Number.isFinite(body.week_number)
      ? Math.round(body.week_number)
      : 0;
  if (weekNumber < 1 || weekNumber > 9999) {
    return { ok: false, error: "Week number must be a positive whole number." };
  }

  const startAt = parseTimestamp(body.start_at);
  const submissionDeadline = parseTimestamp(body.submission_deadline);
  const votingDeadline = parseTimestamp(body.voting_deadline);
  const resultsAt = parseTimestamp(body.results_at);
  if (!startAt || !submissionDeadline || !votingDeadline || !resultsAt) {
    return { ok: false, error: "Fill in all four cycle timestamps." };
  }

  const startMs = Date.parse(startAt);
  const submissionMs = Date.parse(submissionDeadline);
  const votingMs = Date.parse(votingDeadline);
  const resultsMs = Date.parse(resultsAt);
  if (!(startMs < submissionMs && submissionMs <= votingMs && votingMs <= resultsMs)) {
    return {
      ok: false,
      error: "Cycle order must be: start → submission deadline → voting deadline → results.",
    };
  }

  const maxEntries =
    typeof body.max_entries_per_user === "number" && Number.isFinite(body.max_entries_per_user)
      ? Math.round(body.max_entries_per_user)
      : 1;
  if (maxEntries < 1 || maxEntries > 10) {
    return { ok: false, error: "Entries per person must be between 1 and 10." };
  }

  const slugSource =
    typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : title;
  const slug = slugifyCompetitionTitle(slugSource);
  if (!slug) return { ok: false, error: "Could not build a URL slug from that title." };

  const category =
    typeof body.category === "string" && body.category.trim()
      ? body.category.trim().slice(0, 60)
      : "Product Design";

  const coverImageUrl = typeof body.cover_image_url === "string" ? body.cover_image_url.trim() : "";

  return {
    ok: true,
    value: {
      slug,
      weekNumber,
      title,
      description,
      brief: parseBrief(body.brief),
      rules: parseRules(body.rules),
      category,
      difficulty: difficultyRaw as CompetitionDifficulty,
      coverImageUrl: coverImageUrl && isHttpsUrl(coverImageUrl) ? coverImageUrl : null,
      startAt,
      submissionDeadline,
      votingDeadline,
      resultsAt,
      archivedAt: parseTimestamp(body.archived_at),
      maxEntriesPerUser: maxEntries,
      votingRules: parseVotingRules(body.voting_rules),
    },
  };
}
