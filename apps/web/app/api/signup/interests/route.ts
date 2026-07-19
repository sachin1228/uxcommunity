import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";

const schema = z.object({
  interest_ids: z.array(z.string().uuid()).min(0),
});

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
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const userId = session.userId!;

  // Replace all existing interests for this user (upsert pattern)
  await db.from("user_interests").delete().eq("user_id", userId);

  if (parsed.data.interest_ids.length > 0) {
    const rows = parsed.data.interest_ids.map((interest_id) => ({
      user_id: userId,
      interest_id,
    }));
    const { error } = await db.from("user_interests").insert(rows);
    if (error) {
      console.error("[signup/interests] insert error:", error);
      return NextResponse.json({ error: "Failed to save interests." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
