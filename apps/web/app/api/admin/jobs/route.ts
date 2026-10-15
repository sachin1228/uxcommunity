import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

const PAGE_SIZE = 25;

const STATUS_VALUES = new Set(["all", "open", "closed", "expired"]);

/**
 * The jobs moderation queue: every posting on the platform, newest first,
 * with the poster, the company and the applicant count — enough for an admin
 * to judge a posting and remove it when it is fake or spam.
 *
 * The lifecycle reads the same way the member surfaces read it: `closed` is
 * the owner's lever, `expired` is a deadline that passed while the posting
 * stayed open. Closed wins over Expired, exactly like `JobStateBadge`.
 *
 * `job_posts` is not in the generated database types (jobs writes go through
 * RPCs), so this route casts to the untyped client the way the dm-reports
 * queue does.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;

  const requestedStatus = searchParams.get("status") ?? "all";
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : "all";

  // Commas/parens would break the PostgREST or() expression; strip them rather
  // than 500 on a pasted title.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80).replace(/[,()]/g, " ");

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const jobsTable = (db as unknown as SupabaseClient).from("job_posts");

  const now = new Date().toISOString();

  // Search spans the posting title and the names the row displays. PostgREST
  // cannot OR across embedded resources, so the matching poster/company ids
  // resolve first and ride the or() as id lists.
  let posterIds: string[] = [];
  let companyIds: string[] = [];
  if (search) {
    const [posterHits, companyHits] = await Promise.all([
      db
        .from("users")
        .select("id")
        .or(`name.ilike.%${search}%,email.ilike.%${search}%`)
        .limit(100),
      (db as unknown as SupabaseClient)
        .from("companies")
        .select("id")
        .or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
        .limit(100),
    ]);
    posterIds = (posterHits.data ?? []).map((row: { id: string }) => row.id);
    companyIds = ((companyHits.data ?? []) as { id: string }[]).map((row) => row.id);
  }

  /** Every active filter except status — reused for the tab counts. */
  function applySearch(query: any): any {
    if (!search) return query;
    const parts = [`title.ilike.%${search}%`];
    if (posterIds.length) parts.push(`poster_id.in.(${posterIds.join(",")})`);
    if (companyIds.length) parts.push(`company_id.in.(${companyIds.join(",")})`);
    return query.or(parts.join(","));
  }

  /**
   * The three lifecycle buckets, each the same predicate the member pages
   * derive their badge from. Open excludes a passed deadline; expired is an
   * open posting whose deadline passed; closed is the owner's lever and wins.
   */
  function applyState(query: any, state: string): any {
    if (state === "closed") return query.eq("status", "closed");
    if (state === "expired") return query.eq("status", "open").lte("closes_at", now);
    if (state === "open") return query.eq("status", "open").or(`closes_at.is.null,closes_at.gt.${now}`);
    return query;
  }

  const listQuery = applyState(applySearch(jobsTable.select("*", { count: "exact" })), status)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [listResult, openCount, closedCount, expiredCount] = await Promise.all([
    listQuery,
    applyState(applySearch(jobsTable.select("id", { count: "exact", head: true })), "open"),
    applyState(applySearch(jobsTable.select("id", { count: "exact", head: true })), "closed"),
    applyState(applySearch(jobsTable.select("id", { count: "exact", head: true })), "expired"),
  ]);

  if (listResult.error) {
    console.error("[admin/jobs] GET error:", listResult.error);
    return NextResponse.json({ error: "Failed to fetch jobs." }, { status: 500 });
  }

  const rows = (listResult.data ?? []) as unknown as {
    id: string;
    title: string;
    kind: string;
    status: string;
    created_at: string;
    updated_at: string | null;
    closes_at: string | null;
    description: string;
    salary: string | null;
    website: string | null;
    work_mode: string;
    employment_type: string;
    city_id: string | null;
    sector_id: string | null;
    job_title: string;
    experience_level: string;
    poster?: { id: string; name: string | null; email: string | null } | null;
    company?: { id: string; name: string; slug: string; logo_url: string | null } | null;
  }[];

  const jobIds = rows.map((row) => row.id);

  // The four criteria dimensions resolve to their master-data labels; the
  // wildcard (NULL) reads as "All cities" / "All sectors", same as the member
  // cards. Cities/sectors join by id, titles/levels by slug.
  const [citiesRead, sectorsRead, titlesRead, levelsRead, applicationsRead] = await Promise.all([
    db.from("cities").select("id, name"),
    db.from("design_sectors").select("id, name"),
    db.from("job_titles").select("slug, name"),
    db.from("experience_levels").select("slug, name"),
    jobIds.length
      ? (db as unknown as SupabaseClient).from("job_applications").select("job_id").in("job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const cityNames = Object.fromEntries((citiesRead.data ?? []).map((row) => [row.id, row.name]));
  const sectorNames = Object.fromEntries((sectorsRead.data ?? []).map((row) => [row.id, row.name]));
  const titleNames = Object.fromEntries((titlesRead.data ?? []).map((row) => [row.slug, row.name]));
  const levelNames = Object.fromEntries((levelsRead.data ?? []).map((row) => [row.slug, row.name]));

  const applicantCounts = new Map<string, number>();
  for (const row of ((applicationsRead.data ?? []) as { job_id: string }[])) {
    applicantCounts.set(row.job_id, (applicantCounts.get(row.job_id) ?? 0) + 1);
  }

  const nowMs = Date.parse(now);
  const jobs = rows.map((row) => {
    const deadlineExpired = row.closes_at !== null && Date.parse(row.closes_at) <= nowMs;
    const state = row.status === "closed" ? "closed" : deadlineExpired ? "expired" : "open";
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      state,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closes_at: row.closes_at,
      description: row.description,
      salary: row.salary,
      website: row.website,
      work_mode: row.work_mode,
      employment_type: row.employment_type,
      city_name: row.city_id ? (cityNames[row.city_id] ?? null) : "All cities",
      sector_name: row.sector_id ? (sectorNames[row.sector_id] ?? null) : "All sectors",
      job_title_label: titleNames[row.job_title] ?? row.job_title,
      experience_level_label: levelNames[row.experience_level] ?? row.experience_level,
      applicant_count: applicantCounts.get(row.id) ?? 0,
      poster: row.poster ?? null,
      company: row.company ?? null,
    };
  });

  return NextResponse.json({
    jobs,
    total: listResult.count ?? 0,
    counts: {
      open: openCount.error ? 0 : (openCount.count ?? 0),
      closed: closedCount.error ? 0 : (closedCount.count ?? 0),
      expired: expiredCount.error ? 0 : (expiredCount.count ?? 0),
    },
  });
}
