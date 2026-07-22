import { z } from "zod";

export const applicationSchema = z.object({
  name: z.string().min(2, "Full name must be at least 2 characters").max(100),
  email: z.string().email("Please enter a valid email address"),
  linkedin_url: z
    .string()
    .url("Please enter a valid URL")
    .refine((v) => v.includes("linkedin.com"), "Must be a LinkedIn URL"),
  portfolio_url: z.string().url("Please enter a valid portfolio URL"),
});

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupStep1Schema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirm_password: z.string(),
    // L-2: token validated here so the route uses parsed.data.token, not a raw cast
    token: z.string().min(1, "Invitation token is required"),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export const signupStep2Schema = z.object({
  company_id: z.string().uuid("Please select a company"),
  city_id: z.string().uuid("Please select a city"),
  sector_id: z.string().uuid("Please select a design sector"),
  // No longer validated against a hardcoded enum — the experience_levels table
  // (managed via the admin panel) is the source of truth. Any non-empty slug is valid.
  experience_level: z.string().min(1, "Please select an experience level"),
});

export const masterDataSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  image_url: z.string().url().optional().nullable(),
});

export const updateApplicationSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  review_notes: z.string().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
});
