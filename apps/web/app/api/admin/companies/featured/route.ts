import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * The picker's first screen, curated from the admin page.
 *
 * The "Where do you work?" picker opens on an empty search box, and that empty
 * query answers with `companies.featured_rank` in order (migration
 * 20261007150000_company_directory_design_first.sql) before the rest of the
 * directory in name order. GET reads that block; POST features a company at the
 * end of it, takes one out, or moves one position within it.
 *
 * The ordering rules live in the database, in
 * 20261007160000_company_directory_featured_admin.sql: the block stays 1..N with
 * no ties and never contains a deactivated company — and the picker, which reads
 * the same column, is on the new first screen immediately, with no second source
 * of truth.
 */

const curateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["feature", "unfeature", "up", "down"]),
});

export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_featured_companies");

  if (error) {
    console.error("[admin/companies/featured] block read failed:", error);
    return NextResponse.json({ error: "Failed to fetch the first screen." }, { status: 500 });
  }

  return NextResponse.json({ companies: data ?? [] });
}

export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const parsed = curateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { id, action } = parsed.data;
  const db = createServiceClient();

  // Three database functions behind four buttons: `feature` and `unfeature` are
  // one call with a boolean, and the two moves are one call with a direction.
  const { data, error } =
    action === "feature" || action === "unfeature"
      ? await db.rpc("admin_set_company_featured", {
          p_id: id,
          p_featured: action === "feature",
        })
      : await db.rpc("admin_move_company_featured", {
          p_id: id,
          p_direction: action === "up" ? -1 : 1,
        });

  if (error) {
    if (error.code === "P0002" || error.code === "22P02") {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message, message: "Invalid direction." }, { status: 422 });
    }
    if (error.code === "P0001" && error.message === "company_inactive") {
      return NextResponse.json(
        {
          error: "company_inactive",
          message: "Activate this company first — the picker only shows active companies.",
        },
        { status: 409 }
      );
    }
    if (error.code === "P0001" && error.message === "company_not_featured") {
      return NextResponse.json(
        { error: "company_not_featured", message: "That company is not in the first screen." },
        { status: 409 }
      );
    }
    console.error("[admin/companies/featured] curation failed:", error);
    return NextResponse.json({ error: "Failed to update the first screen." }, { status: 500 });
  }

  return NextResponse.json({ featured_rank: data ?? null });
}
