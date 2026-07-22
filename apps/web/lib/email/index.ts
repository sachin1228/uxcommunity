import { Resend } from "resend";

const APP_NAME = "drafthub";

/** Lazily instantiated so the module can be imported at build time without env vars. */
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}
const getFrom = () => {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set");
  return from;
};

const getAppUrl = () => {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return url;
};

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const link = `${getAppUrl()}/reset-password?token=${token}`;

  await getResend().emails.send({
    from: getFrom(),
    to,
    subject: `Reset your ${APP_NAME} password`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#161413;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:#F5F2F0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#161413;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1B1918;border:1px solid #262220;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px 40px 0;background:#1B1918;">
            <p style="margin:0;font-size:20px;font-weight:600;color:#F5F2F0;">
              ${APP_NAME}<span style="color:#0070f3;">/</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#F5F2F0;">
              Reset your password
            </h1>
            <p style="margin:0 0 8px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Hi ${name}, we received a request to reset your ${APP_NAME} password.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Click the button below to choose a new password. This link expires in <strong style="color:#F5F2F0;">1 hour</strong> and can only be used once.
            </p>
            <a href="${link}"
               style="display:inline-block;padding:12px 28px;background:#0070f3;color:#fff;font-size:15px;font-weight:500;border-radius:8px;text-decoration:none;">
              Reset password
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#7B7B7B;">
              If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #262220;">
            <p style="margin:0;font-size:12px;color:#5A5A5A;">
              © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

export async function sendInvitationEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const link = `${getAppUrl()}/signup?token=${token}`;

  await getResend().emails.send({
    from: getFrom(),
    to,
    subject: `You're invited to join ${APP_NAME} 🎉`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#161413;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:#F5F2F0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#161413;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1B1918;border:1px solid #262220;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px 40px 0;background:#1B1918;">
            <p style="margin:0;font-size:20px;font-weight:600;color:#F5F2F0;">
              ${APP_NAME}<span style="color:#0070f3;">/</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#F5F2F0;">
              Welcome, ${name}!
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Your application has been approved. You're invited to create your ${APP_NAME} account and join a curated community of designers — share your work, connect with other creatives, get feedback, and discover new career opportunities.
            </p>
            <a href="${link}"
               style="display:inline-block;padding:12px 28px;background:#0070f3;color:#fff;font-size:15px;font-weight:500;border-radius:8px;text-decoration:none;">
              Create your account
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#7B7B7B;">
              This invitation link expires in ${process.env.INVITATION_EXPIRY_DAYS ?? 7} days and can only be used once.<br/>
              If you didn't apply to ${APP_NAME}, you can ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #262220;">
            <p style="margin:0;font-size:12px;color:#5A5A5A;">
              © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

export async function sendWelcomeEmail(
  to: string,
  name: string
): Promise<void> {
  const dashboardLink = `${getAppUrl()}/dashboard`;

  await getResend().emails.send({
    from: getFrom(),
    to,
    subject: `Welcome to ${APP_NAME} — you're officially in! 🎉`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#161413;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:#F5F2F0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#161413;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1B1918;border:1px solid #262220;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px 40px 0;background:#1B1918;">
            <p style="margin:0;font-size:20px;font-weight:600;color:#F5F2F0;">
              ${APP_NAME}<span style="color:#0070f3;">/</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#F5F2F0;">
              You're officially in, ${name}!
            </h1>
            <p style="margin:0 0 16px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Your ${APP_NAME} account is all set up. Welcome to a curated community of designers — we're glad to have you here.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Head over to your dashboard to complete your profile, share your work, connect with fellow creatives, and discover new career opportunities.
            </p>
            <a href="${dashboardLink}"
               style="display:inline-block;padding:12px 28px;background:#0070f3;color:#fff;font-size:15px;font-weight:500;border-radius:8px;text-decoration:none;">
              Go to your dashboard
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #262220;">
            <p style="margin:0;font-size:12px;color:#5A5A5A;">
              © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

export async function sendRejectionEmail(
  to: string,
  name: string
): Promise<void> {
  const applyLink = `${getAppUrl()}/`;

  await getResend().emails.send({
    from: getFrom(),
    to,
    subject: `An update on your ${APP_NAME} application`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#161413;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:#F5F2F0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#161413;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1B1918;border:1px solid #262220;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px 40px 0;background:#1B1918;">
            <p style="margin:0;font-size:20px;font-weight:600;color:#F5F2F0;">
              ${APP_NAME}<span style="color:#0070f3;">/</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#F5F2F0;">
              Hi ${name},
            </h1>
            <p style="margin:0 0 16px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              Thank you for applying to ${APP_NAME}. After reviewing your portfolio, we weren't able to approve your application at this time.
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#7B7B7B;line-height:1.6;">
              We know this is disappointing, but we genuinely encourage you to keep building. ${APP_NAME} is a curated community for designers who share their work, connect with creatives, and grow their careers — and the bar keeps rising. Take some time to strengthen your case studies and portfolio; we'd love to see you reapply when you're ready.
            </p>
            <a href="${applyLink}"
               style="display:inline-block;padding:12px 28px;background:#262220;border:1px solid #3a3633;color:#F5F2F0;font-size:15px;font-weight:500;border-radius:8px;text-decoration:none;">
              Apply again
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#5A5A5A;">
              If you have any questions, just reply to this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #262220;">
            <p style="margin:0;font-size:12px;color:#5A5A5A;">
              © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}
