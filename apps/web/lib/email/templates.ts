import { APP_NAME } from "@uxcommunity/shared";
import {
  appLink,
  emailButton,
  emailCode,
  emailFinePrint,
  emailParagraph,
  emailStrong,
  renderEmailLayout,
} from "./layout";

/** What a template produces: everything a send needs except the recipients. */
export interface RenderedEmail {
  subject: string;
  html: string;
}

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
  const subject = `Reset your ${APP_NAME} password`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: "Choose a new password — the link expires in 1 hour.",
      heading: "Reset your password",
      content: [
        emailParagraph(`Hi ${name}, we received a request to reset your ${APP_NAME} password.`),
        emailParagraph(
          `Click the button below to choose a new password. This link expires in ${emailStrong(
            "1 hour"
          )} and can only be used once.`,
          { spaced: true }
        ),
        emailButton({ href: link, label: "Reset password" }),
        emailFinePrint(
          "If you didn't request a password reset, you can safely ignore this email — your password won't change."
        ),
      ].join("\n"),
    }),
  };
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
  const subject = `You're invited to join ${APP_NAME} 🎉`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: `Your application was approved — create your ${APP_NAME} account.`,
      heading: `Welcome, ${name}!`,
      content: [
        emailParagraph(
          `Your application has been approved. You're invited to create your ${APP_NAME} account and join a curated community of designers — share your work, connect with other creatives, get feedback, and discover new career opportunities.`,
          { spaced: true }
        ),
        emailButton({ href: link, label: "Create your account" }),
        emailFinePrint(
          `This invitation link expires in ${expiryDays} days and can only be used once.<br />If you didn't apply to ${APP_NAME}, you can ignore this email.`
        ),
      ].join("\n"),
    }),
  };
}

export interface WelcomeEmail {
  name: string;
  appUrl: string;
}

export function renderWelcomeEmail({ name, appUrl }: WelcomeEmail): RenderedEmail {
  const subject = `Welcome to ${APP_NAME} — you're officially in! 🎉`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: "Your account is ready — here's where to start.",
      heading: `You're officially in, ${name}!`,
      content: [
        emailParagraph(
          `Your ${APP_NAME} account is all set up. Welcome to a curated community of designers — we're glad to have you here.`
        ),
        emailParagraph(
          "Head over to your dashboard to complete your profile, share your work, connect with fellow creatives, and discover new career opportunities.",
          { spaced: true }
        ),
        emailButton({ href: appLink(appUrl, "/dashboard"), label: "Go to your dashboard" }),
      ].join("\n"),
    }),
  };
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
  const subject = `Finish setting up your ${APP_NAME} account`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: "Your details are still saved — you're one minute away.",
      heading: `Welcome back, ${name}!`,
      content: [
        emailParagraph(
          `You started creating your ${APP_NAME} account but did not finish. Your details are still saved — pick up where you left off and you'll be in within a minute.`,
          { spaced: true }
        ),
        emailButton({ href: link, label: "Finish my signup" }),
        emailFinePrint(
          `This link expires in ${expiryDays} days. If you did not start signing up, you can ignore this email.`
        ),
      ].join("\n"),
    }),
  };
}

export interface RejectionEmail {
  name: string;
  appUrl: string;
}

export function renderRejectionEmail({ name, appUrl }: RejectionEmail): RenderedEmail {
  const subject = `An update on your ${APP_NAME} application`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: "An update on your application.",
      heading: `Hi ${name},`,
      content: [
        emailParagraph(
          `Thank you for applying to ${APP_NAME}. After reviewing your portfolio, we weren't able to approve your application at this time.`
        ),
        emailParagraph(
          `We know this is disappointing, but we genuinely encourage you to keep building. ${APP_NAME} is a curated community for designers who share their work, connect with creatives, and grow their careers — and the bar keeps rising. Take some time to strengthen your case studies and portfolio; we'd love to see you reapply when you're ready.`,
          { spaced: true }
        ),
        emailButton({ href: appLink(appUrl), label: "Apply again", variant: "secondary" }),
        emailFinePrint("If you have any questions, just reply to this email."),
      ].join("\n"),
    }),
  };
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
 * code is issued for, so the email names both: the code approves a domain, and
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
  const subject = `Your ${APP_NAME} verification code: ${code}`;

  return {
    subject,
    html: renderEmailLayout({
      appUrl,
      subject,
      preheader: `Your code is ${code} — it expires in ${expiresMinutes} minutes.`,
      heading: "Verify your work email",
      content: [
        emailParagraph(
          `Hi ${name}, enter this code to confirm you work at ${emailStrong(companyName)}.`
        ),
        emailParagraph(
          `Proving you control this mailbox verifies the domain ${emailStrong(
            domain
          )}. It does not make you an administrator or an official representative of the company.`,
          { spaced: true }
        ),
        emailCode(code),
        emailFinePrint(
          `This code expires in ${expiresMinutes} minutes and can only be used once. If you didn't ask to add a company to your profile, you can ignore this email.`
        ),
      ].join("\n"),
    }),
  };
}
