/**
 * POST /api/profile/interests
 * Replaces the current user's design interests.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
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

  const { interest_ids } = body as { interest_ids?: string[] };
  if (!Array.isArray(interest_ids)) {
    return NextResponse.json({ error: "interest_ids must be an array." }, { status: 422 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  // Delete existing interests then insert new ones
  const { error: deleteError } = await db.from("user_interests").delete().eq("user_id", userId);
  if (deleteError) {
    console.error("[profile/interests] delete error:", deleteError);
    return NextResponse.json({ error: "Failed to update interests." }, { status: 500 });
  }

  if (interest_ids.length > 0) {
    const rows = interest_ids.map((interest_id) => ({ user_id: userId, interest_id }));
    const { error: insertError } = await db.from("user_interests").insert(rows);
    if (insertError) {
      console.error("[profile/interests] insert error:", insertError);
      return NextResponse.json({ error: "Failed to save interests." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
