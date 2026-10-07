import { APP_NAME } from "@uxcommunity/shared";
import { renderEmail, type EmailBlock, type RenderedEmail } from "./document";
import { appLink } from "./layout";

/**
 * The six emails, each stated once as content and rendered into both bodies.
 */

export interface PasswordResetEmail {
  name: string;
  link: string;
  appUrl: string;
}

export function renderPasswordResetEmail({
  name,
  link,
  appUrl,
}: PasswordResetEmail): RenderedEmail {
  return renderEmail({
    appUrl,
    subject: `Reset your ${APP_NAME} password`,
    preheader: "Choose a new password — the link expires in 1 hour.",
    heading: "Reset your password",
    blocks: [
      { kind: "paragraph", text: `Hi ${name}, we received a request to reset your ${APP_NAME} password.` },
      {
        kind: "paragraph",
        text: `Click the button below to choose a new password. This link expires in **1 hour** and can only be used once.`,
      },
      { kind: "action", label: "Reset password", href: link },
      {
        kind: "finePrint",
        text: "If you didn't request a password reset, you can safely ignore this email — your password won't change.",
      },
    ],
  });
}

export interface InvitationEmail {
  name: string;
  link: string;
  appUrl: string;
  expiryDays: number;
}

export function renderInvitationEmail({
  name,
  link,
  appUrl,
  expiryDays,
}: InvitationEmail): RenderedEmail {
  return renderEmail({
    appUrl,
    subject: `You're invited to join ${APP_NAME} 🎉`,
    preheader: `Your application was approved — create your ${APP_NAME} account.`,
    heading: `Welcome, ${name}!`,
    blocks: [
      {
        kind: "paragraph",
        text: `Your application has been approved. You're invited to create your ${APP_NAME} account and join a curated community of designers — share your work, connect with other creatives, get feedback, and discover new career opportunities.`,
      },
      { kind: "action", label: "Create your account", href: link },
      {
        kind: "finePrint",
        text: `This invitation link expires in ${expiryDays} days and can only be used once. If you didn't apply to ${APP_NAME}, you can ignore this email.`,
      },
    ],
  });
}

export interface WelcomeEmail {
  name: string;
  appUrl: string;
}

export function renderWelcomeEmail({ name, appUrl }: WelcomeEmail): RenderedEmail {
  return renderEmail({
    appUrl,
    subject: `Welcome to ${APP_NAME} — you're officially in! 🎉`,
    preheader: "Your account is ready — here's where to start.",
    heading: `You're officially in, ${name}!`,
    blocks: [
      {
        kind: "paragraph",
        text: `Your ${APP_NAME} account is all set up. Welcome to a curated community of designers — we're glad to have you here.`,
      },
      {
        kind: "paragraph",
        text: "Head over to your dashboard to complete your profile, share your work, connect with fellow creatives, and discover new career opportunities.",
      },
      { kind: "action", label: "Go to your dashboard", href: appLink(appUrl, "/dashboard") },
    ],
  });
}

export interface ResumeSignupEmail {
  name: string;
  link: string;
  appUrl: string;
  expiryDays: number;
}

export function renderResumeSignupEmail({
  name,
  link,
  appUrl,
  expiryDays,
}: ResumeSignupEmail): RenderedEmail {
  return renderEmail({
    appUrl,
    subject: `Finish setting up your ${APP_NAME} account`,
    preheader: "Your details are still saved — you're one minute away.",
    heading: `Welcome back, ${name}!`,
    blocks: [
      {
        kind: "paragraph",
        text: `You started creating your ${APP_NAME} account but did not finish. Your details are still saved — pick up where you left off and you'll be in within a minute.`,
      },
      { kind: "action", label: "Finish my signup", href: link },
      {
        kind: "finePrint",
        text: `This link expires in ${expiryDays} days. If you did not start signing up, you can ignore this email.`,
      },
    ],
  });
}

export interface RejectionEmail {
  name: string;
  appUrl: string;
}

export function renderRejectionEmail({ name, appUrl }: RejectionEmail): RenderedEmail {
  return renderEmail({
    appUrl,
    subject: `An update on your ${APP_NAME} application`,
    preheader: "An update on your application.",
    heading: `Hi ${name},`,
    blocks: [
      {
        kind: "paragraph",
        text: `Thank you for applying to ${APP_NAME}. After reviewing your portfolio, we weren't able to approve your application at this time.`,
      },
      {
        kind: "paragraph",
        text: `We know this is disappointing, but we genuinely encourage you to keep building. ${APP_NAME} is a curated community for designers who share their work, connect with creatives, and grow their careers — and the bar keeps rising. Take some time to strengthen your case studies and portfolio; we'd love to see you reapply when you're ready.`,
      },
      { kind: "action", label: "Apply again", href: appLink(appUrl), variant: "secondary" },
      { kind: "finePrint", text: "If you have any questions, just reply to this email." },
    ],
  });
}

export interface CompanyVerificationEmail {
  name: string;
  appUrl: string;
  companyName: string;
  domain: string;
  code: string;
  expiresMinutes: number;
}

/**
 * The one-time code that proves a member controls a work mailbox on a company
 * domain. The domain — not the company name typed in the form — is what the
 * code is issued for, so the email names both: the code is for a domain, and
 * the member can see exactly which one.
 */
export function renderCompanyVerificationEmail({
  name,
  appUrl,
  companyName,
  domain,
  code,
  expiresMinutes,
}: CompanyVerificationEmail): RenderedEmail {
  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: `Hi ${name}, enter this code to confirm you work at **${companyName}**.`,
    },
    {
      kind: "paragraph",
      text: `The code is for the work email on **${domain}**.`,
    },
    { kind: "code", value: code },
    {
      kind: "finePrint",
      text: `This code expires in ${expiresMinutes} minutes and can only be used once. If you didn't ask to add a company to your profile, you can ignore this email.`,
    },
  ];

  return renderEmail({
    appUrl,
    subject: `Your ${APP_NAME} verification code: ${code}`,
    preheader: `Your code is ${code} — it expires in ${expiresMinutes} minutes.`,
    heading: "Verify your work email",
    blocks,
  });
}
