import { z } from "zod";

/**
 * Public, deletion-only credential form.
 *
 * This is deliberately separate from the session-backed delete route: a
 * blocked or suspended account may have no live session, but must still be
 * able to exercise erasure. The password + literal DELETE are the gate; the
 * endpoint never issues a session or grants access to anything else.
 */
export const deleteCredentialSchema = z.object({
  email: z.string().trim().email("Enter the email address on the account."),
  password: z.string().min(1, "Enter your password."),
  confirmation: z.literal("DELETE", {
    message: "Type DELETE to confirm.",
  }),
});

export type DeleteCredentialInput = z.infer<typeof deleteCredentialSchema>;
