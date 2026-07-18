import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const showAll = request.nextUrl.searchParams.get("all") === "true";
  const db = createServiceClient();

  let query = db
    .from("design_sectors")
    .select("id, name, image_url, is_active, created_at, updated_at")
    .order("name");

  if (!showAll) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch sectors" }, { status: 500 });
  return NextResponse.json({ sectors: data });
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
    .from("design_sectors")
    .insert({ name: parsed.data.name, image_url: parsed.data.image_url ?? null })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A sector with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create sector." }, { status: 500 });
  }
  return NextResponse.json({ sector: data }, { status: 201 });
}
