import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

/**
 * The shelf itself: GET reads it in order; POST features a post at the end of
 * its kind's block, takes one off, or moves one position.
 *
 * The ordering rules live in the database, in
 * 20261015180000_library_curation.sql — positions stay 1..N per kind, and a
 * removal closes the gap — so the member Library page, which reads the same
 * rows through get_library_page, is on the new shelf immediately with no
 * second source of truth.
 */

const curateSchema = z.object({
  type: z.enum(["thread", "showcase", "resource"]),
  id: z.string().uuid(),
  action: z.enum(["feature", "unfeature", "up", "down"]),
});

export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "admin_library_featured", {});

  if (error) {
    console.error("[admin/library/featured] shelf read failed:", error);
    return NextResponse.json({ error: "Failed to fetch the library." }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const parsed = curateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { type, id, action } = parsed.data;
  const db = createServiceClient();

  // Two database functions behind four buttons: `feature` and `unfeature` are
  // one call with a boolean, and the two moves are one call with a direction.
  const { data, error } =
    action === "feature" || action === "unfeature"
      ? await callPerformanceRpc(db, "admin_set_library_item", {
          p_type: type,
          p_id: id,
          p_featured: action === "feature",
          p_curated_by: session.userId ?? null,
        })
      : await callPerformanceRpc(db, "admin_move_library_item", {
          p_type: type,
          p_id: id,
          p_direction: action === "up" ? -1 : 1,
        });

  if (error) {
    if (error.code === "P0002" || error.code === "22P02") {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error.code === "P0001" && error.message === "item_not_featured") {
      return NextResponse.json(
        { error: "item_not_featured", message: "That post is not in the library." },
        { status: 409 }
      );
    }
    console.error("[admin/library/featured] curation failed:", error);
    return NextResponse.json({ error: "Failed to update the library." }, { status: 500 });
  }

  return NextResponse.json({ position: data ?? null });
}
