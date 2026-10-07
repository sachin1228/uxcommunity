import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { profileIdentityUpdateSchema } from "@/lib/validations";

/**
 * PATCH /api/profile/identity
 *
 * The Edit Profile modal's writer. All of the work — the three-month
 * per-slot cooldown, the profile update and the official-group swap —
 * happens inside the update_profile_identity() RPC (one transaction), so
 * this route only validates the payload and maps the SQL errors:
 *
 *   P0001 profile_field_cooldown      → 409 { locked_fields: { slot: available_at } }
 *   P0002 profile_not_found           → 404
 *   22023 invalid_name                → 422
 *   23503 inactive master value       → 422
 *
 * A successful response is the RPC's report: which slots changed and the
 * groups left/joined, so the modal can show what actually happened.
 */
export async function PATCH(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = profileIdentityUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db.rpc("update_profile_identity", {
    p_user_id: session.userId!,
    // `undefined` keeps the RPC parameter's DEFAULT NULL — "leave this slot
    // as it is" — which is what the modal relies on for untouched fields.
    p_name: parsed.data.name ?? undefined,
    p_city_id: parsed.data.city_id ?? undefined,
    p_sector_id: parsed.data.sector_id ?? undefined,
    p_experience_level: parsed.data.experience_level ?? undefined,
    p_job_title: parsed.data.job_title ?? undefined,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "profile_field_cooldown") {
      let lockedFields: Record<string, string> = {};
      try {
        lockedFields = JSON.parse(error.details ?? "{}");
      } catch {
        // The detail is machine-generated JSON; a parse failure just means
        // the client shows the generic cooldown message.
      }
      return NextResponse.json({ error: "profile_field_cooldown", locked_fields: lockedFields }, { status: 409 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 422 });
    }
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "One of your selections is no longer available. Please pick again." },
        { status: 422 }
      );
    }
    console.error("[profile/identity PATCH] rpc error:", error);
    return NextResponse.json({ error: "Failed to update profile. Please try again." }, { status: 500 });
  }

  return NextResponse.json(data ?? {});
}
