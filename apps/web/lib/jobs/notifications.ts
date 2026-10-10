import { after } from "next/server";
import { createNotification } from "@/lib/notifications";
import { logEvent } from "@/lib/observability/log";
import { createServiceClient } from "@/lib/supabase/service";
import { getJobDetail } from "./service";
import { workModeLabel } from "./types";
import type { JobPost } from "./types";

/**
 * Tells every member whose profile matches a freshly posted role.
 *
 * Deferred to after the response, so the poster never waits on the fan-out,
 * and best-effort per member: a notify call that fails only logs — the
 * posting itself stands either way.
 *
 * The recipient set mirrors the eligibility gate `apply_to_job` enforces:
 * job title and experience level exactly, city and sector too unless the
 * posting set them to All (NULL) — those filters are simply left off when
 * the dimension is a wildcard. The poster is never told about their own
 * posting (both the query and createNotification's self-skip).
 */
export function deferJobMatchNotifications(jobId: string, posterId: string) {
  after(async () => {
    try {
      const db = createServiceClient();
      // The payload resolves everything the notice's copy shows — the poster's
      // own view, so `can_apply` is not part of what is read here.
      const job = await getJobDetail(db, posterId, jobId);
      if (!job) return;

      let query = db
        .from("designer_profiles")
        .select("user_id")
        .eq("job_title", job.job_title)
        .eq("experience_level", job.experience_level)
        .neq("user_id", posterId);
      if (job.city_id) query = query.eq("city_id", job.city_id);
      if (job.sector_id) query = query.eq("sector_id", job.sector_id);

      const { data, error } = await query;
      if (error) {
        logEvent("error", {
          event: "jobs.match_notify_recipients_failed",
          job_id: jobId,
          error,
        });
        return;
      }

      const recipients = (data ?? []).map((row) => row.user_id as string);
      await Promise.allSettled(
        recipients.map((userId) =>
          createNotification(db, {
            userId,
            actorId: posterId,
            type: "job_match",
            entityType: "job",
            entityId: job.id,
            title: "A new role matches your profile",
            body: jobMatchBody(job),
            href: `/dashboard/jobs/${job.id}`,
          })
        )
      );
    } catch (error) {
      logEvent("error", { event: "jobs.match_notify_failed", job_id: jobId, error });
    }
  });
}

/** The notice's body: the card's own meta line, so the row reads familiar. */
export function jobMatchBody(job: Pick<JobPost, "title" | "city_name" | "work_mode"> & {
  company: { name: string };
}): string {
  return `${job.title} at ${job.company.name} — ${job.city_name} (${workModeLabel(job.work_mode)})`;
}
