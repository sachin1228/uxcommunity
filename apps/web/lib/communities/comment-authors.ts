import { createServiceClient } from "@/lib/supabase/service";
import { getExperienceLevelNameMap } from "@/lib/master-data-cache";

/**
 * Who wrote a comment, resolved in one place.
 *
 * Every comment surface (threads, showcase, resources, events) needs the same
 * three things about an author: their name, their avatar, and the designation
 * pill the members list shows. That was previously a hand-rolled
 * `users(name)` + `designer_profiles(avatar_url)` pair copied into each route
 * and each server page — so showing a designation meant finding all of them.
 * It is one function now, and a comment author reads exactly like they do in
 * the community roster.
 */

/** The `users` object the comment UI renders. */
export interface CommentAuthor {
  name: string;
  avatar_url: string | null;
  /** Experience-level label, e.g. "Senior designer". Null when unset. */
  designation: string | null;
}

type Db = ReturnType<typeof createServiceClient>;

/**
 * "Heads of Design (all disciplines)" → "Head of Design".
 *
 * The experience-level master table stores labels meant to read as a list
 * heading, so the parenthetical and the plural are stripped before the label is
 * shown as a pill on one person.
 */
export function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

/**
 * Resolve a set of user ids to their author record, keyed by user id. Unknown
 * ids are simply absent, so callers can keep rendering `users: null`.
 */
export async function loadCommentAuthors(
  db: Db,
  userIds: string[],
): Promise<Record<string, CommentAuthor>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};

  const [{ data: users }, { data: profiles }, experienceLevelNames] = await Promise.all([
    db.from("users").select("id, name").in("id", ids),
    db
      .from("designer_profiles")
      .select("user_id, avatar_url, experience_level")
      .in("user_id", ids),
    getExperienceLevelNameMap(),
  ]);

  // Casts, not generated types: this repo runs supabase-js untyped (see
  // next.config.js), so every `data` comes back as `never` until it is cast.
  const nameMap = Object.fromEntries(
    ((users ?? []) as Array<{ id: string; name: string }>).map((user) => [user.id, user.name]),
  );
  const profileMap = Object.fromEntries(
    (
      (profiles ?? []) as Array<{
        user_id: string;
        avatar_url: string | null;
        experience_level: string | null;
      }>
    ).map((profile) => [profile.user_id, profile]),
  );

  const authors: Record<string, CommentAuthor> = {};
  for (const id of ids) {
    const name = nameMap[id];
    if (!name) continue;
    const experienceLevel = profileMap[id]?.experience_level ?? null;
    authors[id] = {
      name,
      avatar_url: profileMap[id]?.avatar_url ?? null,
      designation: experienceLevel
        ? cleanDesignation(experienceLevelNames[experienceLevel] ?? experienceLevel)
        : null,
    };
  }
  return authors;
}

/**
 * Attach `users` to raw comment rows, preserving whatever else the row carried.
 * Callers seed their own `replies` array, since each content type nests a
 * different row shape under it.
 */
export async function attachCommentAuthors<T extends Record<string, unknown>>(
  db: Db,
  rows: T[],
): Promise<Array<T & { users: CommentAuthor | null }>> {
  const authors = await loadCommentAuthors(
    db,
    rows.map((row) => (typeof row.user_id === "string" ? row.user_id : "")),
  );
  return rows.map((row) => ({
    ...row,
    users: authors[typeof row.user_id === "string" ? row.user_id : ""] ?? null,
  }));
}
