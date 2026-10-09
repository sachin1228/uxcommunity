import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { getProfileCompanyState } from "@/lib/companies/service";
import type { JobApplicant, JobPost, JobViewer } from "./types";

/**
 * Server-side access to the Jobs model.
 *
 * Every write goes through a database function that re-checks the poster's
 * verified company and the applicant's profile match, so nothing here can
 * grant eligibility: this module only shapes the request (session user id and
 * the form values) and maps the database's answer back into something a route
 * or a page can render.
 *
 * The job rules themselves are in
 * supabase/migrations/20261009120000_jobs.sql.
 */

/** The migration that installs the feature, for the not-installed hint. */
export const JOBS_MIGRATION = "supabase/migrations/20261009120000_jobs.sql";

const NOT_INSTALLED_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42501", "3F000"]);

/** Failure codes `create_job_post` can report. */
export const CREATE_JOB_FAILURE_CODES = [
  "unknown_user",
  "invalid_kind",
  "invalid_title",
  "missing_description",
  "invalid_work_mode",
  "invalid_employment_type",
  "company_inactive",
  "company_not_verified",
  "invalid_city",
  "invalid_sector",
  "invalid_job_title",
  "invalid_experience_level",
  "invalid_website",
] as const;

export type CreateJobFailureCode = (typeof CREATE_JOB_FAILURE_CODES)[number] | "not_installed" | "unexpected";

export type CreateJobResult =
  | { ok: true; jobId: string }
  | { ok: false; code: CreateJobFailureCode };

/** Failure codes `apply_to_job` can report. */
export const APPLY_FAILURE_CODES = [
  "job_not_found",
  "unknown_user",
  "own_job",
  "invalid_name",
  "invalid_portfolio_url",
  "invalid_linkedin_url",
  "invalid_resume_url",
  "not_eligible",
  "already_applied",
] as const;

export type ApplyFailureCode = (typeof APPLY_FAILURE_CODES)[number] | "not_installed" | "unexpected";

export type ApplyResult = { ok: true; applicationId: string } | { ok: false; code: ApplyFailureCode };

export type ApplicantsResult =
  | { ok: true; applicants: JobApplicant[] }
  | { ok: false; code: "not_your_job" | "not_installed" | "unexpected" };

/**
 * PostgREST reports a raised exception as its message. The job functions use
 * stable messages (`not_eligible`, `company_not_verified`, …) so the route can
 * map them onto HTTP statuses without parsing prose.
 */
function readRaised(error: PostgrestError | null): string {
  if (!error) return "unexpected";

  if (error.code && NOT_INSTALLED_CODES.has(error.code)) {
    console.error(
      `[jobs] the jobs feature is not installed on this database (${error.code}: ${error.message}). ` +
        `Apply ${JOBS_MIGRATION}, then reload the PostgREST schema cache.`
    );
    return "not_installed";
  }

  return (error.message ?? "").trim().split("\n")[0].trim() || "unexpected";
}

function asJsonObject(value: Json): { [key: string]: unknown } | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { [key: string]: unknown })
    : null;
}

/** Trust the SQL payload contract (same convention as the feed functions). */
function asJobPost(value: Json): JobPost | null {
  return asJsonObject(value) as unknown as JobPost | null;
}

function asJobApplicant(value: Json): JobApplicant | null {
  return asJsonObject(value) as unknown as JobApplicant | null;
}

/** Newest-first page of postings, each with the viewer's flags. */
export async function getJobFeed(
  db: SupabaseClient,
  viewerId: string,
  limit = 50
): Promise<JobPost[]> {
  const { data, error } = await callPerformanceRpc(db, "get_job_feed", {
    p_viewer_id: viewerId,
    p_limit: limit,
  });

  if (error) {
    console.error("[jobs] feed read failed:", error);
    return [];
  }

  return (data ?? []).map((row) => asJobPost(row.item)).filter((job): job is JobPost => Boolean(job));
}

export async function getJobDetail(
  db: SupabaseClient,
  viewerId: string,
  jobId: string
): Promise<JobPost | null> {
  const { data, error } = await callPerformanceRpc(db, "get_job_detail", {
    p_job_id: jobId,
    p_viewer_id: viewerId,
  });

  if (error) {
    console.error("[jobs] detail read failed:", error);
    return null;
  }

  return asJobPost((data ?? [])[0]?.item ?? null);
}

/** The poster's applicant list; anyone else is refused by the database. */
export async function getJobApplicants(
  db: SupabaseClient,
  posterId: string,
  jobId: string
): Promise<ApplicantsResult> {
  const { data, error } = await callPerformanceRpc(db, "get_job_applicants", {
    p_poster_id: posterId,
    p_job_id: jobId,
  });

  if (error) {
    const code = readRaised(error);
    if (code === "not_your_job" || code === "not_installed") {
      return { ok: false, code };
    }
    console.error("[jobs] applicants read failed:", error);
    return { ok: false, code: "unexpected" };
  }

  const applicants = (data ?? [])
    .map((row) => asJobApplicant(row.item))
    .filter((applicant): applicant is JobApplicant => Boolean(applicant));

  return { ok: true, applicants };
}

export interface CreateJobParams {
  posterId: string;
  kind: string;
  companyId: string;
  title: string;
  cityId: string;
  sectorId: string;
  jobTitle: string;
  experienceLevel: string;
  workMode: string;
  employmentType: string;
  salary: string | null;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  website: string | null;
}

export async function createJobPost(
  db: SupabaseClient,
  params: CreateJobParams
): Promise<CreateJobResult> {
  const { data, error } = await callPerformanceRpc(db, "create_job_post", {
    p_poster_id: params.posterId,
    p_kind: params.kind,
    p_company_id: params.companyId,
    p_title: params.title,
    p_city_id: params.cityId,
    p_sector_id: params.sectorId,
    p_job_title: params.jobTitle,
    p_experience_level: params.experienceLevel,
    p_work_mode: params.workMode,
    p_employment_type: params.employmentType,
    p_salary: params.salary,
    p_description: params.description,
    p_responsibilities: params.responsibilities,
    p_requirements: params.requirements,
    p_skills: params.skills,
    p_website: params.website,
  });

  if (error) {
    const code = readRaised(error);
    const known = (CREATE_JOB_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] create failed:", error);
    }
    return { ok: false, code: known ? (code as CreateJobFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] create returned no row");
    return { ok: false, code: "unexpected" };
  }

  return { ok: true, jobId: row.job_id };
}

export interface ApplyParams {
  jobId: string;
  applicantId: string;
  name: string;
  portfolioUrl: string;
  linkedinUrl: string;
  resumeUrl: string | null;
}

export async function applyToJob(db: SupabaseClient, params: ApplyParams): Promise<ApplyResult> {
  const { data, error } = await callPerformanceRpc(db, "apply_to_job", {
    p_job_id: params.jobId,
    p_applicant_id: params.applicantId,
    p_name: params.name,
    p_portfolio_url: params.portfolioUrl,
    p_linkedin_url: params.linkedinUrl,
    p_resume_url: params.resumeUrl,
  });

  if (error) {
    const code = readRaised(error);
    const known = (APPLY_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] apply failed:", error);
    }
    return { ok: false, code: known ? (code as ApplyFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] apply returned no row");
    return { ok: false, code: "unexpected" };
  }

  return { ok: true, applicationId: row.application_id };
}

/**
 * The signed-in member's side of everything the jobs pages need: their name
 * and avatar, the four profile criteria the eligibility rule compares, the
 * contact links the apply form prefills, and the verified profile company the
 * referral flow posts under.
 */
export async function loadJobViewer(db: SupabaseClient, userId: string): Promise<JobViewer | null> {
  const [userRead, profileRead, companyState] = await Promise.all([
    db.from("users").select("name, email").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select("avatar_url, city_id, sector_id, experience_level, job_title, portfolio_url, linkedin_url")
      .eq("user_id", userId)
      .maybeSingle(),
    getProfileCompanyState(db, userId),
  ]);

  if (userRead.error) console.error("[jobs] viewer user read failed:", userRead.error);
  if (profileRead.error) console.error("[jobs] viewer profile read failed:", profileRead.error);

  if (!userRead.data) return null;

  const profile = profileRead.data as {
    avatar_url?: string | null;
    city_id?: string | null;
    sector_id?: string | null;
    experience_level?: string | null;
    job_title?: string | null;
    portfolio_url?: string | null;
    linkedin_url?: string | null;
  } | null;

  return {
    id: userId,
    name: userRead.data.name ?? "Member",
    email: userRead.data.email ?? "",
    avatarUrl: profile?.avatar_url ?? null,
    cityId: profile?.city_id ?? null,
    sectorId: profile?.sector_id ?? null,
    jobTitle: profile?.job_title ?? null,
    experienceLevel: profile?.experience_level ?? null,
    portfolioUrl: profile?.portfolio_url ?? null,
    linkedinUrl: profile?.linkedin_url ?? null,
    company: companyState.company
      ? {
          id: companyState.company.id,
          name: companyState.company.name,
          slug: companyState.company.slug,
          logoUrl: companyState.company.logoUrl,
        }
      : null,
  };
}

export interface JobMasterData {
  cities: { id: string; name: string; imageUrl: string | null }[];
  sectors: { id: string; name: string; imageUrl: string | null }[];
  jobTitles: { slug: string; label: string; imageUrl: string | null }[];
  experienceLevels: { slug: string; label: string; imageUrl: string | null }[];
}

/** The four criteria option lists — the same master data signup offers. */
export async function loadJobMasterData(db: SupabaseClient): Promise<JobMasterData> {
  const [cities, sectors, jobTitles, experienceLevels] = await Promise.all([
    db.from("cities").select("id, name, image_url").eq("is_active", true).order("name"),
    db.from("design_sectors").select("id, name, image_url").eq("is_active", true).order("name"),
    db.from("job_titles").select("slug, name, image_url").eq("is_active", true).order("name"),
    db.from("experience_levels").select("slug, name, image_url").eq("is_active", true).order("name"),
  ]);

  for (const [label, read] of [
    ["cities", cities],
    ["sectors", sectors],
    ["job titles", jobTitles],
    ["experience levels", experienceLevels],
  ] as const) {
    if (read.error) console.error(`[jobs] master data (${label}) read failed:`, read.error);
  }

  return {
    cities: (cities.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      imageUrl: (row.image_url as string | null) ?? null,
    })),
    sectors: (sectors.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      imageUrl: (row.image_url as string | null) ?? null,
    })),
    jobTitles: (jobTitles.data ?? []).map((row) => ({
      slug: row.slug as string,
      label: row.name as string,
      imageUrl: (row.image_url as string | null) ?? null,
    })),
    experienceLevels: (experienceLevels.data ?? []).map((row) => ({
      slug: row.slug as string,
      label: row.name as string,
      imageUrl: (row.image_url as string | null) ?? null,
    })),
  };
}
