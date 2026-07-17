import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signupStep2Schema } from "@/lib/validations";
import { requireSession } from "@/lib/auth/session";

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

  const parsed = signupStep2Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { company_id, city_id, sector_id, experience_level } = parsed.data;
  const db = createServiceClient();

  // Check if profile already exists
  const { data: existing } = await db
    .from("designer_profiles")
    .select("id")
    .eq("user_id", session.userId!)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "Profile already exists." },
      { status: 409 }
    );
  }

  const { error } = await db.from("designer_profiles").insert({
    user_id: session.userId,
    company_id: company_id ?? null,
    city_id: city_id ?? null,
    sector_id,
    experience_level,
  });

  if (error) {
    console.error("[signup/profile] insert error:", error);
    return NextResponse.json(
      { error: "Failed to save profile. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
