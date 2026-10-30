/**
 * Renders an application résumé for one surface.
 *
 * Web pages get a stable `/api/private/resume/application/<id>` path: the
 * browser sends its session cookie and the route re-checks access before
 * redirecting to a short-lived signed URL. Mobile has no cookie on a
 * `Linking.openURL` call, so its API responses carry a presigned URL generated
 * after the route already authorized the caller.
 */

import { isPrivateObjectKey, resumeApplicationPath, signPrivateGet } from "@/lib/r2-private";
import type { JobApplicant, JobPost } from "@/lib/jobs/types";

const MOBILE_SIGNED_URL_TTL_SECONDS = 15 * 60;

interface ResumeBearer {
  id: string;
  resume_url: string | null;
  resume_key?: string | null;
}

/** Web: the authorization-gated path, or the legacy public URL. */
export function webResumeUrl(item: ResumeBearer): string | null {
  if (item.resume_key && isPrivateObjectKey(item.resume_key)) {
    return resumeApplicationPath(item.id);
  }
  return item.resume_url;
}

/** Mobile: a short-lived URL, or the legacy public URL. */
export async function signedResumeUrl(item: ResumeBearer): Promise<string | null> {
  if (!item.resume_key || !isPrivateObjectKey(item.resume_key)) return item.resume_url;
  try {
    return await signPrivateGet(item.resume_key, {
      expiresInSeconds: MOBILE_SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("[jobs] resume signing failed:", error);
    return null;
  }
}

export function withWebJobResumePath<T extends JobPost>(job: T): T {
  if (!job.my_application) return job;
  return {
    ...job,
    my_application: { ...job.my_application, resume_url: webResumeUrl(job.my_application) },
  };
}

export function withWebApplicantResumePath<T extends JobApplicant>(applicant: T): T {
  return { ...applicant, resume_url: webResumeUrl(applicant) };
}

export async function withMobileJobResumeUrl<T extends JobPost>(job: T): Promise<T> {
  if (!job.my_application) return job;
  return {
    ...job,
    my_application: {
      ...job.my_application,
      resume_url: await signedResumeUrl(job.my_application),
    },
  };
}

export async function withMobileApplicantResumeUrl<T extends JobApplicant>(applicant: T): Promise<T> {
  return { ...applicant, resume_url: await signedResumeUrl(applicant) };
}
