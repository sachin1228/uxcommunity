import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";

const VALID_TYPES = ["city", "sector", "interest", "company", "experience_level"] as const;

const upsertSchema = z.object({
  scope: z.enum(["universal", "type", "community"]),
  scope_key: z.string().min(1),
  lottie_url: z.string().url(),
});

export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const { data, error } = await db
    .from("lottie_settings")
    .select("id, scope, scope_key, lottie_url, created_at, updated_at")
    .order("scope")
    .order("scope_key");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch lottie settings." }, { status: 500 });
  }
  return NextResponse.json({ settings: data ?? [] });
}

export async function PUT(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const parsed = upsertSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { scope, scope_key, lottie_url } = parsed.data;

  // Extra validation: type scope key must be a valid community type
  if (scope === "type" && !VALID_TYPES.includes(scope_key as typeof VALID_TYPES[number])) {
    return NextResponse.json(
      { error: `Invalid community type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("lottie_settings")
    .upsert({ scope, scope_key, lottie_url }, { onConflict: "scope,scope_key" })
    .select()
    .single();

  if (error) {
    console.error("[lottie-settings PUT]", error);
    return NextResponse.json({ error: "Failed to save lottie setting." }, { status: 500 });
  }
  return NextResponse.json({ setting: data }, { status: 200 });
}
