import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const showAll = request.nextUrl.searchParams.get("all") === "true";
  const db = createServiceClient();

  let query = db
    .from("design_interests")
    .select("id, name, is_active, created_at, updated_at")
    .order("name");

  if (!showAll) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch interests" }, { status: 500 });
  // Return with image_url: null so MasterDataPage renders correctly
  return NextResponse.json({ interests: data?.map((r) => ({ ...r, image_url: null })) ?? [] });
}

export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const parsed = masterDataSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("design_interests")
    .insert({ name: parsed.data.name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An interest with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create interest." }, { status: 500 });
  }
  return NextResponse.json({ interest: data }, { status: 201 });
}
