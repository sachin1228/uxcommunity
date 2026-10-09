import { z } from "zod";

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
  description: z.string().trim().min(1, "Add a role description").max(8000),
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
});

export type JobPostInput = z.infer<typeof jobPostSchema>;
export type JobApplicationInput = z.infer<typeof jobApplicationSchema>;
