import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  VERIFICATION_MAX_ATTEMPTS,
  hashVerificationCode,
  isVerificationCode,
} from "@/lib/companies/codes";
import {
  confirmCompanyVerification,
  findDomainOwner,
  getProfileCompanyState,
  type ConfirmStatus,
} from "@/lib/companies/service";

/**
 * Redeems the code sent to a work mailbox.
 *
 * The verification id is opaque and belongs to the session member, so the only
 * thing a caller can influence is which of their own challenges they redeem.
 * The company, the domain and the membership are all derived by the database
 * function from the challenge that was opened server-side.
 */
const confirmSchema = z.object({
  verification_id: z.string().uuid(),
  code: z.string().trim(),
});

const STATUS_FOR_CONFIRM: Record<Exclude<ConfirmStatus, "verified">, number> = {
  invalid_code: 422,
  not_found: 404,
  already_used: 409,
  expired: 410,
  too_many_attempts: 429,
  company_inactive: 410,
  domain_not_verified: 409,
  domain_already_verified: 409,
  not_installed: 503,
  unexpected: 500,
};

function statusMessage(
  status: Exclude<ConfirmStatus, "verified">,
  attemptsLeft: number | null
): string {
  switch (status) {
    case "invalid_code":
      return attemptsLeft && attemptsLeft > 0
        ? `That code doesn't match. ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.`
        : "That code doesn't match. Request a new one.";
    case "expired":
      return "That code has expired. Request a new one.";
    case "already_used":
      return "That code has already been used. Request a new one.";
    case "too_many_attempts":
      return `Too many wrong codes. Request a new one to try again.`;
    case "not_found":
      return "That verification is no longer available. Start again from your profile.";
    case "company_inactive":
      return "This company is no longer active, so it can't be added to your profile.";
    case "domain_not_verified":
      return "That domain is no longer verified for this company. Start again from search.";
    case "domain_already_verified":
      return "Someone verified that domain first. Search for the company and join it instead.";
    case "not_installed":
      return "Adding a company isn't available right now. Please try again later.";
    default:
      return "Something went wrong verifying your email. Please try again.";
  }
}

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;

  const limited = await rateLimit(`company-verify-confirm:${userId}`, 20, 600);
  if (!limited.success) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid request body." }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success || !isVerificationCode(parsed.data.code)) {
    return NextResponse.json(
      {
        error: "invalid_code",
        message: `Enter the ${6}-digit code from the email.`,
        attemptsLeft: null,
      },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const confirmed = await confirmCompanyVerification(db, {
    userId,
    verificationId: parsed.data.verification_id,
    codeHash: hashVerificationCode(parsed.data.code),
  });

  if (confirmed.ok) {
    return NextResponse.json({ company: confirmed.company });
  }

  if (confirmed.status === "domain_already_verified") {
    // The rare race: another member proved this domain between the request and
    // the code being entered. The member still holds an unconsumed challenge,
    // so read the domain back from it — never from the request body — and name
    // the company they should join instead.
    const state = await getProfileCompanyState(db, userId);
    const owner = state.pending ? await findDomainOwner(db, state.pending.domain) : null;

    return NextResponse.json(
      {
        error: confirmed.status,
        message: owner
          ? `${owner.name} already verified that domain. Join ${owner.name} instead.`
          : statusMessage(confirmed.status, confirmed.attemptsLeft),
        ...(owner ? { company: owner } : {}),
      },
      { status: STATUS_FOR_CONFIRM[confirmed.status] }
    );
  }

  return NextResponse.json(
    {
      error: confirmed.status,
      message: statusMessage(confirmed.status, confirmed.attemptsLeft),
      attemptsLeft: confirmed.attemptsLeft,
      maxAttempts: VERIFICATION_MAX_ATTEMPTS,
    },
    { status: STATUS_FOR_CONFIRM[confirmed.status] ?? 500 }
  );
}
