import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Admin company directory — the list the picker's "Where do you work?" flow
 * reads is the SAME table (`public.companies` / `public.company_domains`), so a
 * company added here appears in the app and one deleted here disappears,
 * immediately and with no second source of truth to keep in sync.
 *
 * The rules live in the database (20261007140000_company_directory_admin.sql):
 * this route only validates the shape of the request and maps the database's
 * refusals onto status codes.
 */

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  domain: z.string().trim().max(253).optional().nullable(),
  logo_url: z.string().url().optional().nullable(),
});

/** The company a taken name or domain points at, when the database says so. */
function companyFromDetail(details: string | null | undefined): { id: string; name: string } | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { company_id?: string; company_name?: string; is_active?: boolean };
    if (typeof parsed.company_id === "string") {
      return { id: parsed.company_id, name: parsed.company_name ?? "another company" };
    }
  } catch {
    // The detail is machine-generated JSON; a parse failure just means the
    // client shows the generic message.
  }
  return null;
}

export async function GET(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const showAll = request.nextUrl.searchParams.get("all") === "true";
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 500);
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);

  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_list_companies", {
    p_query: query.trim().slice(0, 80),
    p_all: showAll,
    p_limit: Number.isFinite(limit) ? limit : 500,
    p_offset: Number.isFinite(offset) ? offset : 0,
  });

  if (error) {
    console.error("[admin/companies] list failed:", error);
    return NextResponse.json({ error: "Failed to fetch companies." }, { status: 500 });
  }

  const companies = data ?? [];
  return NextResponse.json({
    companies,
    total: companies[0]?.total_count ?? 0,
  });
}

export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_create_company", {
    p_name: parsed.data.name,
    p_domain: parsed.data.domain?.trim() || null,
    p_logo_url: parsed.data.logo_url ?? null,
  });

  if (error) {
    if (error.code === "P0001" && (error.message === "company_name_taken" || error.message === "domain_taken")) {
      return NextResponse.json(
        {
          error: error.message,
          message:
            error.message === "company_name_taken"
              ? "A company with this name already exists."
              : "That domain is already used by another company.",
          company: companyFromDetail(error.details),
        },
        { status: 409 }
      );
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message, message: "Enter a name and a valid domain." }, { status: 422 });
    }
    console.error("[admin/companies] create failed:", error);
    return NextResponse.json({ error: "Failed to create company." }, { status: 500 });
  }

  return NextResponse.json({ company: (data ?? [])[0] ?? null }, { status: 201 });
}
