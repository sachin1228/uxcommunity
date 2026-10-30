import test from "node:test";
import assert from "node:assert/strict";

import type { JobApplicant, JobPost } from "./types";
import {
  signedResumeUrl,
  webResumeUrl,
  withWebApplicantResumePath,
  withWebJobResumePath,
} from "./private-resume";

const ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_PUBLIC_URL: "https://media.example.test",
  R2_PRIVATE_BUCKET_NAME: "uxcommunity-private",
};

function setEnv(values: Record<string, string>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function applicant(overrides: Partial<JobApplicant> = {}): JobApplicant {
  return {
    id: "application-id",
    applicant_id: "applicant-id",
    name: "Applicant",
    portfolio_url: "https://portfolio.test",
    linkedin_url: "https://linkedin.com/in/applicant",
    resume_url: null,
    created_at: "2026-10-30T00:00:00.000Z",
    avatar_url: null,
    status: "new",
    applied_label: "now",
    ...overrides,
  };
}

test("web surfaces get the authorization-gated path for a private key", () => {
  assert.equal(
    webResumeUrl({ id: "app-1", resume_url: null, resume_key: "resumes/u/a.pdf" }),
    "/api/private/resume/application/app-1",
  );
});

test("legacy rows keep their public URL until migrated", () => {
  assert.equal(
    webResumeUrl({ id: "app-1", resume_url: "https://media.example.test/resumes/u/a.pdf", resume_key: null }),
    "https://media.example.test/resumes/u/a.pdf",
  );
});

test("non-private keys are never treated as private", () => {
  assert.equal(
    webResumeUrl({ id: "app-1", resume_url: "https://cdn.test/a.pdf", resume_key: "avatars/u/a.webp" }),
    "https://cdn.test/a.pdf",
  );
});

test("mobile gets a short-lived signed URL, never the key", async () => {
  const restore = setEnv(ENV);
  try {
    const url = await signedResumeUrl({
      id: "app-1",
      resume_url: null,
      resume_key: "resumes/u/a.pdf",
    });
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), String(15 * 60));
    assert.match(parsed.pathname, /^\/resumes\/u\/a\.pdf$/);
  } finally {
    restore();
  }
});

test("applicant mapping preserves the profile facts the design view needs", () => {
  const detail = {
    ...applicant({ resume_key: "resumes/u/a.pdf" }),
    role_label: "Product Designer",
    city_name: "Pune",
    applied_label: "2d ago",
  };
  const mapped = withWebApplicantResumePath(detail);
  assert.equal(mapped.role_label, "Product Designer");
  assert.equal(mapped.city_name, "Pune");
  assert.equal(mapped.resume_url, "/api/private/resume/application/application-id");
});

test("job mapping leaves posts without an application untouched", () => {
  const job = {
    id: "job-1",
    my_application: null,
  } as unknown as JobPost;
  assert.equal(withWebJobResumePath(job), job);
});
