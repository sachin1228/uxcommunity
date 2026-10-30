import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

// Name is collected as two separate mandatory inputs (name + surname) and
// combined before it reaches the API, so a valid name always has two words.
const nameWithSurname = z
  .string()
  .min(2, "Name must be at least 2 characters")
  .max(100)
  .refine((v) => v.trim().split(/\s+/).length >= 2, {
    message: "Please enter both your name and surname.",
  });

export const directSignupStep1Schema = z
  .object({
    name: nameWithSurname,
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirm_password: z.string(),
    // Eligibility and consent are recorded on the account at completion; the
    // API refuses to create an account without both. Defaulting to false makes
    // an older client that omits the flags fail with the same human message
    // instead of Zod's generic "Required".
    age_confirmed: z
      .boolean()
      .default(false)
      .refine((v) => v === true, { message: "You must confirm that you are 18 or older." }),
    terms_accepted: z
      .boolean()
      .default(false)
      .refine((v) => v === true, {
        message: "You must accept the Terms of Service and Privacy Policy.",
      }),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export const signupStep2Schema = z.object({
  city_id: z.string().uuid("Please select a city"),
  sector_id: z.string().uuid("Please select a design sector"),
  // No longer validated against a hardcoded enum — the experience_levels table
  // (managed via the admin panel) is the source of truth. Any non-empty slug is valid.
  experience_level: z.string().min(1, "Please select an experience level"),
  // Same approach for job titles — the job_titles table is the source of truth.
  job_title: z.string().min(1, "Please select a job title"),
});

export const completeSignupSchema = z.object({
  identity: directSignupStep1Schema,
  profile: signupStep2Schema,
  avatar_source: z.literal("upload").optional(),
  // Picture pre-uploaded via /api/signup/picture (validated + on R2).
  avatar_url: z.string().url().optional(),
});

export const masterDataSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  image_url: z.string().url().optional().nullable(),
});

// Edit-profile modal: the identity slots a member can change. Each slot is
// gated by a three-month cooldown server-side; the client only sends the
// fields the member actually touched, so every field is optional but the
// payload must carry at least one.
export const profileIdentityUpdateSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
    city_id: z.string().uuid("Please select a city"),
    sector_id: z.string().uuid("Please select a design sector"),
    experience_level: z.string().min(1, "Please select an experience level"),
    job_title: z.string().min(1, "Please select a job title"),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

export const updateApplicationSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  review_notes: z.string().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
});
