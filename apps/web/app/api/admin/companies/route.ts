import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const showAll = request.nextUrl.searchParams.get("all") === "true";
  const db = createServiceClient();

  let query = db
    .from("companies")
    .select("id, name, is_active, created_at, updated_at")
    .order("name");

  if (!showAll) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
  return NextResponse.json({ companies: data });
}

export async function POST(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const parsed = masterDataSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("companies")
    .insert({ name: parsed.data.name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A company with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create company." }, { status: 500 });
  }

  return NextResponse.json({ company: data }, { status: 201 });
}
