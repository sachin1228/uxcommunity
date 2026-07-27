import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── PUT /api/admin/communities/[id]/rules/[ruleId] ───────────────────────────
// Updates rule_text and/or order_index for a single rule.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, ruleId } = await params;

  let body: { rule_text?: string; order_index?: number };
  try { body = await request.json(); } catch { body = {}; }

  const update: Record<string, unknown> = {};
  if (typeof body.rule_text === "string") {
    const text = body.rule_text.trim();
    if (!text) return NextResponse.json({ error: "rule_text cannot be empty." }, { status: 422 });
    if (text.length > 500) return NextResponse.json({ error: "Rule text too long (max 500 chars)." }, { status: 422 });
    update.rule_text = text;
  }
  if (typeof body.order_index === "number") {
    update.order_index = body.order_index;
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("community_rules")
    .update(update)
    .eq("id", ruleId)
    .eq("community_id", id)
    .select("id, rule_text, order_index, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update rule." }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// ── DELETE /api/admin/communities/[id]/rules/[ruleId] ────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, ruleId } = await params;
  const db = createServiceClient();

  const { error } = await db
    .from("community_rules")
    .delete()
    .eq("id", ruleId)
    .eq("community_id", id);

  if (error) return NextResponse.json({ error: "Failed to delete rule." }, { status: 500 });
  return NextResponse.json({ success: true });
}
