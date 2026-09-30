import { Resend } from "resend";
import { appLink } from "./layout";
import {
  renderCompanyVerificationEmail,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderRejectionEmail,
  renderResumeSignupEmail,
  renderWelcomeEmail,
  type RenderedEmail,
} from "./templates";

/**
 * Sending, and nothing else.
 *
 * The markup lives in `./templates`, so a change of brand touches one layout
 * instead of six copies of it, and every email can be rendered and inspected
 * without an API key or a network call.
 */

/** Lazily instantiated so the module can be imported at build time without env vars. */
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}
const getFrom = () => {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  return from;
};

const getAppUrl = () => {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return url;
};

/** The window an invitation link and a resumed signup link stay valid for. */
const invitationExpiryDays = () => Number(process.env.INVITATION_EXPIRY_DAYS ?? 7);

async function send(to: string, email: RenderedEmail): Promise<void> {
  await getResend().emails.send({
    from: getFrom(),
    to,
    subject: email.subject,
    html: email.html,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const appUrl = getAppUrl();

  await send(
    to,
    renderPasswordResetEmail({
      name,
      appUrl,
      link: appLink(appUrl, `/reset-password?token=${token}`),
    })
  );
}

export async function sendInvitationEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const appUrl = getAppUrl();

  await send(
    to,
    renderInvitationEmail({
      name,
      appUrl,
      link: appLink(appUrl, `/signup?token=${token}`),
      expiryDays: invitationExpiryDays(),
    })
  );
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  await send(to, renderWelcomeEmail({ name, appUrl: getAppUrl() }));
}

export async function sendResumeSignupEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const appUrl = getAppUrl();

  await send(
    to,
    renderResumeSignupEmail({
      name,
      appUrl,
      link: appLink(appUrl, `/signup?resume=${token}`),
      expiryDays: invitationExpiryDays(),
    })
  );
}

export async function sendRejectionEmail(to: string, name: string): Promise<void> {
  await send(to, renderRejectionEmail({ name, appUrl: getAppUrl() }));
}

export async function sendCompanyVerificationEmail(
  to: string,
  name: string,
  details: { companyName: string; domain: string; code: string; expiresMinutes: number }
): Promise<void> {
  const { companyName, domain, code, expiresMinutes } = details;

  await send(
    to,
    renderCompanyVerificationEmail({
      name,
      appUrl: getAppUrl(),
      companyName,
      domain,
      code,
      expiresMinutes,
    })
  );
}
