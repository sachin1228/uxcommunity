import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { sendCompanyVerificationEmail } from "@/lib/email";
import {
  checkWorkEmail,
  companyNameMatchesDomain,
  suggestedCompanyName,
} from "@/lib/companies/domains";
import {
  getCompanyVerification,
  refusedCompany,
  startCompanyVerification,
  type StartFailureCode,
} from "@/lib/companies/service";
import {
  VERIFICATION_CODE_TTL_MINUTES,
  generateVerificationCode,
  hashVerificationCode,
} from "@/lib/companies/codes";

/**
 * Starts (or resends) a work-email challenge for a company.
 *
 * The client picks a company from search — or types a name for a company that
 * does not exist yet — and gives a work email. Which company the member ends
 * up in is decided by the verified domain behind that email, and every one of
 * those checks runs inside `start_company_verification`; this route only
 * normalises the input and turns the database's answer into a status code.
 *
 * A resend is the same call: the database retires the member's previous
 * challenge and issues a fresh code, so an older email can never be replayed.
 * A resend is requested with the id of the member's own challenge instead of a
 * work email — after a reload the browser no longer holds the address, so the
 * server reads it back from the challenge it issued. A client cannot aim a
 * code at an address it did not start a challenge for.
 */
const startSchema = z
  .object({
    company_id: z.string().uuid().nullish(),
    company_name: z.string().trim().min(1).max(120).nullish(),
    work_email: z.string().trim().min(3).max(254).optional(),
    // Present only when the member is asking for a fresh code.
    verification_id: z.string().uuid().optional(),
  })
  .refine((body) => Boolean(body.verification_id) || Boolean(body.work_email), {
    message: "Enter your work email address.",
  });

const STATUS_FOR_FAILURE: Record<StartFailureCode, number> = {
  invalid_work_email: 422,
  invalid_domain: 422,
  email_domain_mismatch: 422,
  company_name_required: 422,
  company_inactive: 410,
  company_name_taken: 409,
  domain_not_verified_for_company: 409,
  domain_already_verified: 409,
  already_member: 409,
  unknown_user: 401,
  not_installed: 503,
  unexpected: 500,
};

/**
 * `reserved` marks the refusal that is not about a proven domain: the domain is
 * one the company directory already lists for a company (a hint nobody has
 * proved yet, see supabase/migrations/20260929130000_company_directory_hints.sql).
 * The member's action is the same either way — join that company — but the
 * reason has to be told truthfully, because "already verified" would be a
 * claim nobody has made.
 */
function failureMessage(
  code: StartFailureCode,
  companyName: string | null,
  reserved = false
): string {
  switch (code) {
    case "domain_already_verified":
      if (reserved) {
        return companyName
          ? `That domain is already listed for ${companyName}. Join ${companyName} instead.`
          : "That domain is already listed for another company. Search for that company and join it instead.";
      }
      return companyName
        ? `${companyName} already has that domain verified. Join ${companyName} instead.`
        : "That domain is already verified for another company. Search for that company and join it instead.";
    case "company_name_taken":
      return companyName
        ? `A company called ${companyName} already exists. Pick it from search and verify with a ${companyName} work email to join it, or give yours a distinguishing name.`
        : "A company with that name already exists. Pick it from search instead.";
    case "domain_not_verified_for_company":
      return "That domain isn't one of this company's domains. Check which company owns your work email's domain, or use a different work email.";
    case "already_member":
      return "You've already verified a work email for this company.";
    case "company_inactive":
      return "This company is no longer active. Pick another company or create a new one.";
    case "company_name_required":
      return "Enter the name of your company.";
    case "invalid_work_email":
    case "email_domain_mismatch":
      return "Enter a valid work email address.";
    case "invalid_domain":
      return "That email's domain isn't a valid company domain.";
    case "unknown_user":
      return "Your session is no longer valid. Sign in again.";
    case "not_installed":
      return "Adding a company isn't available right now. Please try again later.";
    default:
      return "Something went wrong sending the verification code. Please try again.";
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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Sending mail is the expensive part, so both the member and the caller IP
  // are limited. The per-member window is the effective one for a member
  // retrying a code; the IP window blunts a scripted run.
  const [perUser, perIp] = await Promise.all([
    rateLimit(`company-verification:${userId}`, 5, 3600),
    rateLimit(`company-verification-ip:${ip}`, 10, 3600),
  ]);
  if (!perUser.success || !perIp.success) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many verification emails requested. Try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid request body." }, { status: 400 });
  }

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_email", message: "Enter your work email address." },
      { status: 422 }
    );
  }

  const db = createServiceClient();

  // Resolve the claim: either a fresh one from the request, or the member's own
  // outstanding challenge when they asked for another code.
  let claim: { domain: string; workEmail: string; companyId: string | null; companyName: string | null };

  if (parsed.data.verification_id) {
    const existing = await getCompanyVerification(db, userId, parsed.data.verification_id);
    if (!existing) {
      return NextResponse.json(
        {
          error: "not_found",
          message: "That verification is no longer available. Start again from your profile.",
        },
        { status: 404 }
      );
    }
    claim = {
      domain: existing.domain,
      workEmail: existing.workEmail,
      companyId: existing.companyId,
      companyName: existing.companyId ? null : existing.companyName,
    };
  } else {
    const workEmail = parsed.data.work_email!;

    // Policy check (free providers, malformed addresses) before anything is
    // written. `checkWorkEmail` is the same function the picker uses, so the
    // member usually sees this message before the request leaves the browser.
    const emailCheck = checkWorkEmail(workEmail);
    if (!emailCheck.ok) {
      return NextResponse.json(
        {
          error: emailCheck.reason === "personal" ? "personal_email" : "invalid_email",
          message: emailCheck.message,
        },
        { status: 422 }
      );
    }

    const requestedName = parsed.data.company_name?.trim() ?? null;

    // A NEW company is named by hand while its trust comes from the domain, so
    // the name has to correspond to the domain being proved. Without this the
    // first person from `acme.com` could label it "Microsoft", and because a
    // name can only be used once, the real Microsoft would later be told to
    // join a company whose verified domain is acme.com. Joining an existing
    // company is unaffected: there the domain has to match that company's own
    // verified domains, which the database checks.
    if (!parsed.data.company_id && requestedName) {
      const nameMatch = companyNameMatchesDomain(requestedName, emailCheck.domain);
      if (!nameMatch.ok) {
        const suggestion = suggestedCompanyName(emailCheck.domain);
        return NextResponse.json(
          {
            error: "company_name_domain_mismatch",
            message: suggestion
              ? `A company is named after the domain it proves. For ${emailCheck.domain}, use a name like “${suggestion}”.`
              : `A company is named after the domain it proves, and “${requestedName}” doesn't match ${emailCheck.domain}.`,
            domain: emailCheck.domain,
            suggested_name: suggestion,
          },
          { status: 422 }
        );
      }
    }

    claim = {
      domain: emailCheck.domain,
      workEmail: workEmail.trim().toLowerCase(),
      // The company id is only a hint at this point: the database re-derives
      // the company from the verified domain and refuses anything that does
      // not match, so a client cannot claim a company by posting its id.
      companyId: parsed.data.company_id ?? null,
      companyName: parsed.data.company_id ? null : requestedName,
    };
  }

  const code = generateVerificationCode();
  const started = await startCompanyVerification(db, {
    userId,
    domain: claim.domain,
    workEmail: claim.workEmail,
    codeHash: hashVerificationCode(code),
    companyId: claim.companyId,
    companyName: claim.companyName,
    ttlMinutes: VERIFICATION_CODE_TTL_MINUTES,
  });

  if (!started.ok) {
    const refused = refusedCompany(started);
    return NextResponse.json(
      {
        error: started.code,
        message: failureMessage(
          started.code,
          refused?.name ?? null,
          started.detail?.reason === "reserved"
        ),
        ...(refused ? { company: refused } : {}),
      },
      { status: STATUS_FOR_FAILURE[started.code] ?? 500 }
    );
  }

  try {
    await sendCompanyVerificationEmail(claim.workEmail, session.email ?? "there", {
      companyName: started.verification.companyName,
      domain: started.verification.domain,
      code,
      expiresMinutes: VERIFICATION_CODE_TTL_MINUTES,
    });
  } catch (emailError) {
    console.error("[companies] verification email failed:", emailError);
    return NextResponse.json(
      {
        error: "email_failed",
        message: "We couldn't send the verification email just now. Please try again.",
      },
      { status: 502 }
    );
  }

  // The raw work email never leaves the server: only the masked form the picker
  // shows back to the member who typed it.
  return NextResponse.json({ pending: started.verification });
}
