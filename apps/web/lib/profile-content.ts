import type { SupabaseClient } from "@supabase/supabase-js";

export interface PostCommunity {
  id: string;
  name: string;
  image_url: string | null;
}

/**
 * Normalises a PostgREST `communities(...)` embed (object or single-element
 * array) into the { id, name, image_url } shape the profile cards expect.
 */
export function communityOf(raw: unknown): PostCommunity | null {
  if (!raw) return null;
  const row = (Array.isArray(raw) ? raw[0] : raw) as
    | { id?: string; name?: string; image_url?: string | null }
    | null
    | undefined;
  if (!row?.name) return null;
  return { id: row.id ?? "", name: row.name, image_url: row.image_url ?? null };
}

/**
 * Resolves the real author for each row ({ name, avatar_url } | null) so every
 * profile surface — most importantly the Saved tab, where posts are rarely the
 * viewer's own — shows the actual author instead of the viewer.
 */
export async function attachAuthors(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];
  if (!userIds.length) return rows;

  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  return rows.map((row) => {
    const id = row.user_id as string;
    return {
      ...row,
      users:
        nameMap[id] !== undefined
          ? { name: nameMap[id], avatar_url: avatarMap[id] ?? null }
          : null,
    };
  });
}
