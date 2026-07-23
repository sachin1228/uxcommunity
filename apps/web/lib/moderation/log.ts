import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModerationLogInput } from "./types";

export async function logModerationDecision(
  db: SupabaseClient,
  input: ModerationLogInput,
): Promise<void> {
  const { decision } = input;
  const { error } = await db.from("moderation_events").insert({
    user_id: input.userId ?? null,
    content_type: input.contentType,
    content_ref_id: input.contentRefId ?? null,
    content_hash: input.contentHash ?? null,
    status: decision.status,
    reason: decision.reason || null,
    provider: decision.provider,
    confidence: decision.confidence,
    triggered_rules: decision.triggered_rules,
    scores: decision.scores,
    duration_ms: decision.duration_ms,
  });

  if (error) {
    console.error("[moderation:log]", error);
  }
}
