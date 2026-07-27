import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── GET /api/admin/communities/[id]/rules ────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_rules")
    .select("id, rule_text, order_index, created_at")
    .eq("community_id", id)
    .order("order_index", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to load rules." }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

// ── POST /api/admin/communities/[id]/rules ───────────────────────────────────
// Appends a new rule at the end of the ordered list.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  let body: { rule_text?: string };
  try { body = await request.json(); } catch { body = {}; }

  const rule_text = body.rule_text?.trim();
  if (!rule_text) return NextResponse.json({ error: "rule_text is required." }, { status: 422 });
  if (rule_text.length > 500) return NextResponse.json({ error: "Rule text too long (max 500 chars)." }, { status: 422 });

  const db = createServiceClient();

  // Find the next order_index
  const { data: existing } = await db
    .from("community_rules")
    .select("order_index")
    .eq("community_id", id)
    .order("order_index", { ascending: false })
    .limit(1);

  const next_index = existing?.length ? (existing[0].order_index + 1) : 0;

  const { data, error } = await db
    .from("community_rules")
    .insert({ community_id: id, rule_text, order_index: next_index })
    .select("id, rule_text, order_index, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to create rule." }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}
