import "server-only";

/**
 * Server-side guards shared by the competition write routes.
 *
 * The deadline rules live here (and nowhere else) so a submission, a vote and
 * a comment can never disagree about whether a cycle is still open — and so
 * every check runs on the server, never trusting anything the browser sent.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { canComment, canSubmitEntry, canVote } from "./cycle";
import type { Competition, CompetitionEntry } from "./types";

type Db = ReturnType<typeof createServiceClient>;

export interface GuardFailure {
  ok: false;
  status: number;
  error: string;
}

export type Guard = { ok: true } | GuardFailure;

const ALLOWED: Guard = { ok: true } as const;

function fail(status: number, error: string): GuardFailure {
  return { ok: false, status, error };
}

export function assertCanSubmit(competition: Competition): Guard {
  if (competition.status === "upcoming") {
    return fail(403, "This challenge has not started yet.");
  }
  if (!canSubmitEntry(competition.status)) {
    return fail(403, "Submissions are closed for this challenge.");
  }
  return ALLOWED;
}

export function assertCanVote(competition: Competition): Guard {
  if (competition.status === "upcoming") {
    return fail(403, "Voting opens when the challenge starts.");
  }
  if (!canVote(competition.status)) {
    return fail(403, "Voting has closed for this challenge.");
  }
  return ALLOWED;
}

export function assertCanComment(competition: Competition): Guard {
  if (!canComment(competition.status)) {
    return fail(403, "This challenge is closed for comments.");
  }
  return ALLOWED;
}

/**
 * Loads an entry that belongs to the given competition and is not
 * soft-deleted. Returns null when it does not exist or does not belong here,
 * so a caller can never act on another competition's entry by guessing an id.
 */
export async function loadLiveEntry(
  db: Db,
  competitionId: string,
  entryId: string,
): Promise<CompetitionEntry | null> {
  const { data, error } = await db
    .from("competition_entries")
    .select(
      "id, competition_id, user_id, title, cover_image_url, design_image_url, soft_deleted_at, created_at",
    )
    .eq("id", entryId)
    .eq("competition_id", competitionId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (row.soft_deleted_at) return null;

  return {
    id: String(row.id),
    competition_id: String(row.competition_id),
    user_id: String(row.user_id),
    title: String(row.title ?? ""),
    description: "",
    cover_image_url: String(row.cover_image_url ?? ""),
    design_image_url: String(row.design_image_url ?? row.cover_image_url ?? ""),
    image_urls: [],
    figma_url: null,
    prototype_url: null,
    tools: [],
    tags: [],
    is_featured: false,
    created_at: String(row.created_at),
    updated_at: String(row.created_at),
    author_name: "",
    author_avatar_url: null,
    author_role: null,
    vote_count: 0,
    comment_count: 0,
    user_voted: false,
    user_bookmarked: false,
  };
}

/** Ownership check for edit / delete of one's own submission. */
export function assertOwnEntry(entry: CompetitionEntry, userId: string): Guard {
  if (entry.user_id !== userId) return fail(403, "This is not your entry.");
  return ALLOWED;
}

/** Turns a guard into a JSON response, or null when the guard passed. */
export function guardResponse(guard: Guard): Response | null {
  return guard.ok ? null : new Response(JSON.stringify({ error: guard.error }), {
    status: guard.status,
    headers: { "Content-Type": "application/json" },
  });
}
