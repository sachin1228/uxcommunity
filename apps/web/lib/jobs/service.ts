import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { getProfileCompanyState } from "@/lib/companies/service";
import { companyLogoUrl } from "@/lib/companies/logos";
import { resolveProfileRoleLabel } from "@/lib/profile/role-label";
import type {
  JobApplicant,
  JobApplicantDetail,
  JobPost,
  JobStatus,
  ApplicationStatus,
  JobViewer,
} from "./types";

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

/**
 * Failure codes `apply_to_job` can report. `job_closed` and `job_expired` are
 * the lifecycle's contribution — the owner ended the posting, or its deadline
 * passed — and the database says which rather than the client hiding a button.
 */
export const APPLY_FAILURE_CODES = [
  "job_not_found",
  "unknown_user",
  "own_job",
  "job_closed",
  "job_expired",
  "invalid_name",
  "invalid_portfolio_url",
  "invalid_linkedin_url",
  "invalid_resume_url",
  "not_eligible",
  "already_applied",
] as const;

export type ApplyFailureCode = (typeof APPLY_FAILURE_CODES)[number] | "not_installed" | "unexpected";

export type ApplyResult = { ok: true; applicationId: string } | { ok: false; code: ApplyFailureCode };

/**
 * Failure codes `update_job_post` can report. The content codes are the same
 * shape checks `create_job_post` applies — an edit can never store something
 * the create path would have refused — plus the owner and lifecycle gates.
 */
export const UPDATE_JOB_FAILURE_CODES = [
  "job_not_found",
  "not_your_job",
  "criteria_locked",
  "invalid_title",
  "missing_description",
  "invalid_work_mode",
  "invalid_employment_type",
  "invalid_city",
  "invalid_sector",
  "invalid_job_title",
  "invalid_experience_level",
  "invalid_website",
] as const;

export type UpdateJobFailureCode =
  | (typeof UPDATE_JOB_FAILURE_CODES)[number]
  | "not_installed"
  | "unexpected";

export type UpdateJobResult =
  | { ok: true; jobId: string; editedAt: string | null }
  | { ok: false; code: UpdateJobFailureCode };

/** Failure codes `set_job_post_status` can report. */
export const SET_JOB_STATUS_FAILURE_CODES = [
  "job_not_found",
  "not_your_job",
  "invalid_status",
] as const;

export type SetJobStatusFailureCode =
  | (typeof SET_JOB_STATUS_FAILURE_CODES)[number]
  | "not_installed"
  | "unexpected";

export type SetJobStatusResult =
  | { ok: true; jobId: string; status: JobStatus }
  | { ok: false; code: SetJobStatusFailureCode };

/** Failure codes `delete_job_post` can report. */
export const DELETE_JOB_FAILURE_CODES = ["job_not_found", "not_your_job"] as const;

export type DeleteJobFailureCode =
  | (typeof DELETE_JOB_FAILURE_CODES)[number]
  | "not_installed"
  | "unexpected";

export type DeleteJobResult = { ok: true; jobId: string } | { ok: false; code: DeleteJobFailureCode };

export type ApplicantsResult =
  | { ok: true; applicants: JobApplicant[] }
  | { ok: false; code: "not_your_job" | "not_installed" | "unexpected" };

/** Failure codes `set_job_application_status` can report. */
export const SET_APPLICATION_STATUS_FAILURE_CODES = [
  "application_not_found",
  "not_your_job",
  "invalid_status",
] as const;

export type SetApplicationStatusFailureCode =
  | (typeof SET_APPLICATION_STATUS_FAILURE_CODES)[number]
  | "not_installed"
  | "unexpected";

export type SetApplicationStatusResult =
  | { ok: true; applicationId: string; status: ApplicationStatus }
  | { ok: false; code: SetApplicationStatusFailureCode };

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
  const job = asJsonObject(value) as unknown as JobPost | null;
  if (!job || !job.company) return job;
  // The SQL carries the stored logo + the company's domain; resolving here
  // gives the jobs surfaces the same picture the profile shows (the stored
  // image, else the domain's icon — never a name-derived placeholder).
  return {
    ...job,
    company: { ...job.company, logo_url: companyLogoUrl(job.company.logo_url, job.company.domain) },
  };
}

function asJobApplicant(value: Json): JobApplicant | null {
  const applicant = asJsonObject(value) as unknown as JobApplicant | null;
  // Until the triage migration is applied the payload carries no `status`;
  // an application without one has never been decided, so it reads as new.
  if (applicant && !applicant.status) applicant.status = "new";
  return applicant;
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

/** One applicant's profile row as the design-view enrichment reads it. */
interface ApplicantProfileRow {
  user_id: string;
  job_title: string | null;
  experience_level: string | null;
  cities: { name: string } | null;
}

/**
 * The applicants the design view renders, each with the profile facts the
 * SQL payload does not carry — the composed role label and the city — so
 * the sidebar can show what the member actually filled in. Read in one
 * batch (the applicant count does not multiply the queries), and a miss
 * degrades to null rather than failing the board: the application itself
 * is complete without it.
 *
 * The role label resolves through the same helper the profile pages use, so
 * the design view can never disagree with a profile on how a role reads.
 */
export async function loadJobApplicantDetails(
  db: SupabaseClient,
  applicants: JobApplicant[]
): Promise<JobApplicantDetail[]> {
  if (applicants.length === 0) return [];

  const ids = [...new Set(applicants.map((applicant) => applicant.applicant_id))];
  const profileRead = await db
    .from("designer_profiles")
    .select("user_id, job_title, experience_level, cities(name)")
    .in("user_id", ids);

  if (profileRead.error) console.error("[jobs] applicant profile read failed:", profileRead.error);

  const profiles = new Map(
    ((profileRead.data ?? []) as unknown as ApplicantProfileRow[]).map((row) => [row.user_id, row])
  );

  const roleLabels = new Map(
    await Promise.all(
      ids.map(async (id) => {
        const profile = profiles.get(id);
        const label = await resolveProfileRoleLabel(
          db,
          profile?.job_title ?? null,
          profile?.experience_level ?? null
        );
        return [id, label] as const;
      })
    )
  );

  return applicants.map((applicant) => {
    const profile = profiles.get(applicant.applicant_id);
    return {
      ...applicant,
      role_label: roleLabels.get(applicant.applicant_id) ?? null,
      city_name: profile?.cities?.name ?? null,
    };
  });
}

/**
 * The poster's triage of one application: shortlist, reject, or move back to
 * new. A standing decision, freely reversible — the database re-checks the
 * poster through the application's own job on every write.
 */
export async function setJobApplicationStatus(
  db: SupabaseClient,
  params: { actorId: string; applicationId: string; status: ApplicationStatus }
): Promise<SetApplicationStatusResult> {
  const { data, error } = await callPerformanceRpc(db, "set_job_application_status", {
    p_actor_id: params.actorId,
    p_application_id: params.applicationId,
    p_status: params.status,
  });

  if (error) {
    const code = readRaised(error);
    const known = (SET_APPLICATION_STATUS_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] application status change failed:", error);
    }
    return { ok: false, code: known ? (code as SetApplicationStatusFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] application status change returned no row");
    return { ok: false, code: "unexpected" };
  }

  // The database returns the stored status, so the route never echoes the
  // value the request asked for.
  return {
    ok: true,
    applicationId: row.application_id,
    status: row.application_status as ApplicationStatus,
  };
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
  /** The closing date's instant, or null for no deadline. */
  closesAt: string | null;
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
    p_closes_at: params.closesAt,
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

export interface UpdateJobParams {
  actorId: string;
  jobId: string;
  title: string;
  cityId: string;
  sectorId: string;
  jobTitle: string;
  experienceLevel: string;
  workMode: string;
  employmentType: string;
  salary: string | null;
  description: string;
  /** NULL leaves the stored list alone — see `update_job_post`. */
  responsibilities: string[] | null;
  requirements: string[] | null;
  skills: string[] | null;
  website: string | null;
  /** The closing date's instant; null clears the deadline. */
  closesAt: string | null;
}

/**
 * Save an edit. Only the poster's own posting can be written, and the four
 * targeting dimensions are frozen once an application exists — both rules
 * live in `update_job_post`, so the caller gets the database's answer rather
 * than a client-side guess. The closing date is NOT part of that freeze: it
 * moves freely, because it changes until when applications are taken, not who
 * is eligible. `editedAt` is the stamp the write set; it stays put when the
 * save changed nothing.
 */
export async function updateJobPost(
  db: SupabaseClient,
  params: UpdateJobParams
): Promise<UpdateJobResult> {
  const { data, error } = await callPerformanceRpc(db, "update_job_post", {
    p_actor_id: params.actorId,
    p_job_id: params.jobId,
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
    p_closes_at: params.closesAt,
  });

  if (error) {
    const code = readRaised(error);
    const known = (UPDATE_JOB_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] update failed:", error);
    }
    return { ok: false, code: known ? (code as UpdateJobFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] update returned no row");
    return { ok: false, code: "unexpected" };
  }

  return { ok: true, jobId: row.job_id, editedAt: row.edited_at ?? null };
}

/**
 * Close or reopen a posting. Closing is the reversible end of a role's life:
 * the row, its URL, its applicant list and its history all stay.
 */
export async function setJobPostStatus(
  db: SupabaseClient,
  params: { actorId: string; jobId: string; status: JobStatus }
): Promise<SetJobStatusResult> {
  const { data, error } = await callPerformanceRpc(db, "set_job_post_status", {
    p_actor_id: params.actorId,
    p_job_id: params.jobId,
    p_status: params.status,
  });

  if (error) {
    const code = readRaised(error);
    const known = (SET_JOB_STATUS_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] status change failed:", error);
    }
    return { ok: false, code: known ? (code as SetJobStatusFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] status change returned no row");
    return { ok: false, code: "unexpected" };
  }

  // The database returns the stored status, so the route never echoes the
  // value the request asked for.
  return { ok: true, jobId: row.job_id, status: row.job_status as JobStatus };
}

/**
 * Permanently delete a posting. The applications cascade with the row, so this
 * is the irreversible action — closing is the reversible one. Resume objects
 * stay in R2 for the orphan audit to reclaim.
 */
export async function deleteJobPost(
  db: SupabaseClient,
  params: { actorId: string; jobId: string }
): Promise<DeleteJobResult> {
  const { data, error } = await callPerformanceRpc(db, "delete_job_post", {
    p_actor_id: params.actorId,
    p_job_id: params.jobId,
  });

  if (error) {
    const code = readRaised(error);
    const known = (DELETE_JOB_FAILURE_CODES as readonly string[]).includes(code);
    if (!known && code !== "not_installed") {
      console.error("[jobs] delete failed:", error);
    }
    return { ok: false, code: known ? (code as DeleteJobFailureCode) : code === "not_installed" ? "not_installed" : "unexpected" };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[jobs] delete returned no row");
    return { ok: false, code: "unexpected" };
  }

  return { ok: true, jobId: row.job_id };
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
