import { z } from "zod";
import { closingInstantFromDate } from "./format";
import {
  RICH_TEXT_MAX_CHARS,
  RICH_TEXT_MAX_HTML_CHARS,
  richTextIsEmpty,
  richTextToPlainText,
  trimRichText,
} from "./rich-text";

/** Resumes are attached as files; only the URL-shaped fields are validated here. */
export const jobApplicationSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  portfolio_url: z
    .string()
    .trim()
    .url("Enter a valid portfolio URL")
    .refine((v) => /^https?:\/\//i.test(v), "Portfolio URL must start with http(s)://"),
  linkedin_url: z
    .string()
    .trim()
    .url("Enter a valid LinkedIn URL")
    .refine((v) => /^https?:\/\//i.test(v), "LinkedIn URL must start with http(s)://")
    .refine((v) => v.includes("linkedin.com"), "Must be a LinkedIn URL"),
});

// The list fields arrive as arrays of lines; the database re-trims and caps
// them, so the route only enforces the outer limits.
const listField = z.array(z.string()).max(20, "At most 20 lines").optional();

export const jobPostSchema = z.object({
  kind: z.enum(["hiring", "referral"]),
  company_id: z.string().uuid("Select a verified company"),
  title: z.string().trim().min(2, "Add a role title").max(140),
  city_id: z.string().uuid("Select a city"),
  sector_id: z.string().uuid("Select a sector"),
  job_title: z.string().min(1, "Select a job title"),
  experience_level: z.string().min(1, "Select an experience level"),
  work_mode: z.enum(["remote", "hybrid", "onsite"]),
  employment_type: z.enum(["full_time", "part_time", "contract", "internship"]),
  salary: z.string().trim().max(80).optional().or(z.literal("")),
  /**
   * The description arrives as the rich field's html — or as plain text, from a
   * caller that never touched the editor. Both go through the same sanitiser
   * here, on the server, so the column only ever holds the subset the reader
   * knows how to draw and nobody can skip the editor to store markup of their
   * own choosing.
   *
   * Two limits, because there are two things to bound. The poster's is about
   * the words: 8000 characters, however they format them. The store's is about
   * the tags that carry those words, and is the constraint the migration sets
   * on the column. The raw bound is checked first, so a huge body is refused
   * before anything tries to parse it.
   */
  description: z
    .string()
    .max(RICH_TEXT_MAX_HTML_CHARS * 2, "That description is too long")
    .transform((value) => trimRichText(value))
    .refine((value) => !richTextIsEmpty(value), "Add a role description")
    .refine(
      (value) => richTextToPlainText(value).trim().length <= RICH_TEXT_MAX_CHARS,
      `Keep the description to ${RICH_TEXT_MAX_CHARS} characters`
    )
    .refine(
      (value) => value.length <= RICH_TEXT_MAX_HTML_CHARS,
      "That description carries more formatting than we can store — simplify it and try again"
    ),
  responsibilities: listField,
  requirements: listField,
  skills: listField,
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || /^https?:\/\/\S+$/i.test(v),
      "Website must start with http(s)://"
    ),
  /**
   * The closing date as a plain date, exactly as the date input holds it. It is
   * REQUIRED to be present (blank meaning no deadline) so a caller always
   * states its intent: the database parameter is trailing and defaulted, and an
   * omission there would silently clear a deadline a poster had set.
   *
   * Converted here, in the one place both writes pass through, so no route
   * re-implements the date-to-instant rule.
   */
  closes_at: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || closingInstantFromDate(v) !== null,
      "Enter a valid closing date"
    )
    .transform((v) => (v === "" ? null : closingInstantFromDate(v))),
});

export type JobPostInput = z.infer<typeof jobPostSchema>;
export type JobApplicationInput = z.infer<typeof jobApplicationSchema>;

/**
 * An edit carries the same role fields as a post — minus `kind` and
 * `company_id`. Those two are the verified proof a posting was made under;
 * changing either one is a different posting, not an edit, so the route never
 * accepts them and `update_job_post` never reads them. The closing date rides
 * along and is freely movable: it changes until when applications are taken,
 * never who is eligible.
 */
export const jobPostUpdateSchema = jobPostSchema.omit({ kind: true, company_id: true });

export type JobPostUpdateInput = z.infer<typeof jobPostUpdateSchema>;

/** Close / reopen. Anything else is refused before the database is called. */
export const jobStatusSchema = z.object({
  status: z.enum(["open", "closed"]),
});
