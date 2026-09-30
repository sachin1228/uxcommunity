import assert from "node:assert/strict";
import { test } from "node:test";
import { emailTheme } from "./theme";
import { EMAIL_LOGO_PATH } from "./layout";
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
 * Every email the product sends renders through one layout, so these tests pin
 * the two things that silently drift apart when a template is written by hand:
 * the brand (the shared palette and the logo mark, not a text wordmark) and the
 * structure a mail client needs (a preheader, one card, the legal footer).
 *
 * The palette assertions are literal on purpose. Reading the expected colours
 * back out of `emailTheme` would only prove that a template agrees with the
 * theme — including a theme that has drifted from the design system. Asking for
 * the design system's own hexes means a change there has to be acknowledged
 * here, deliberately.
 */

const APP_URL = "https://app.uxcommunity.in";

/** The six emails, rendered with representative data. */
const RENDERED: Array<[name: string, email: RenderedEmail]> = [
  [
    "password reset",
    renderPasswordResetEmail({
      name: "Ada",
      appUrl: APP_URL,
      link: `${APP_URL}/reset-password?token=t1`,
    }),
  ],
  [
    "invitation",
    renderInvitationEmail({
      name: "Ada",
      appUrl: APP_URL,
      link: `${APP_URL}/signup?token=t2`,
      expiryDays: 7,
    }),
  ],
  ["welcome", renderWelcomeEmail({ name: "Ada", appUrl: APP_URL })],
  [
    "resumed signup",
    renderResumeSignupEmail({
      name: "Ada",
      appUrl: APP_URL,
      link: `${APP_URL}/signup?resume=t3`,
      expiryDays: 7,
    }),
  ],
  ["rejection", renderRejectionEmail({ name: "Ada", appUrl: APP_URL })],
  [
    "company verification",
    renderCompanyVerificationEmail({
      name: "Ada",
      appUrl: APP_URL,
      companyName: "Figma",
      domain: "figma.com",
      code: "482913",
      expiresMinutes: 30,
    }),
  ],
];

/**
 * The warm palette the emails used to carry — a near-black with a brown cast
 * (#161413, #1B1918) and warm greys (#F5F2F0, #7B7B7B) — which the design
 * system replaced with its cool Geist neutral scale. Written out so that a
 * copy-paste of an old template cannot creep back in unnoticed.
 */
const RETIRED_PALETTE = [
  "#161413",
  "#1B1918",
  "#262220",
  "#3a3633",
  "#F5F2F0",
  "#7B7B7B",
  "#5A5A5A",
  "#888888",
];

const has = (html: string, value: string) => html.toLowerCase().includes(value.toLowerCase());

test("every email carries the design system's dark palette", () => {
  for (const [name, email] of RENDERED) {
    for (const [token, colour] of Object.entries({
      page: emailTheme.page,
      card: emailTheme.card,
      heading: emailTheme.heading,
      body: emailTheme.text,
      divider: emailTheme.divider,
    })) {
      assert.ok(has(email.html, colour), `${name} email is missing the ${token} colour ${colour}`);
    }
  }
});

test("no email still uses the retired warm palette", () => {
  for (const [name, email] of RENDERED) {
    for (const colour of RETIRED_PALETTE) {
      assert.ok(!has(email.html, colour), `${name} email still uses the retired colour ${colour}`);
    }
  }
});

test("every email shows the logo mark, not just a text wordmark", () => {
  for (const [name, email] of RENDERED) {
    assert.ok(
      email.html.includes(`${APP_URL}${EMAIL_LOGO_PATH}`),
      `${name} email does not point at the brand mark`
    );
    assert.ok(
      email.html.includes('alt="uxcommunity"'),
      `${name} email has no accessible logo description`
    );
    assert.ok(email.html.includes(">uxcommunity</a>"), `${name} email has no wordmark`);
  }
});

test("every email is a complete, dark-scheme document with a hidden preheader", () => {
  for (const [name, email] of RENDERED) {
    assert.ok(email.html.startsWith("<!DOCTYPE html>"), `${name} email is not a document`);
    assert.ok(email.html.trimEnd().endsWith("</html>"), `${name} email is not closed`);
    assert.ok(
      email.html.includes('content="dark"'),
      `${name} email does not declare the dark colour scheme`
    );
    assert.match(
      email.html,
      /<div style="display:none;[^"]*">[^<]{10,}<\/div>/,
      `${name} email has no inbox preview line`
    );
    assert.ok(
      email.html.includes(`© ${new Date().getFullYear()} uxcommunity`),
      `${name} email has no copyright footer`
    );
    assert.ok(email.subject.trim().length > 0, `${name} email has no subject`);
  }
});

/** Emails whose ask is a single primary action — the code email has none. */
const PRIMARY_ACTION_EMAILS = ["password reset", "invitation", "welcome", "resumed signup"];

test("a primary call to action is the product's white-on-black action", () => {
  for (const name of PRIMARY_ACTION_EMAILS) {
    const email = RENDERED.find(([label]) => label === name)?.[1];
    assert.ok(email, `no rendered email named ${name}`);
    assert.ok(
      email.html.includes(`background-color:${emailTheme.accent}`) &&
        email.html.includes(`color:${emailTheme.accentText}`),
      `${name} email does not use the primary action style`
    );
  }
});

test("the rejection email offers a quieter action than a primary one", () => {
  const rejection = RENDERED.find(([name]) => name === "rejection");
  assert.ok(rejection);
  assert.ok(
    rejection[1].html.includes(`background-color:${emailTheme.secondary}`),
    "the rejection email has no secondary action"
  );
  assert.ok(
    !rejection[1].html.includes(`background-color:${emailTheme.accent};`),
    "the rejection email should not lead with the primary action"
  );
});

test("a link never doubles the slash when the app origin ends in one", () => {
  const email = renderPasswordResetEmail({
    name: "Ada",
    appUrl: `${APP_URL}/`,
    link: `${APP_URL}/reset-password?token=t1`,
  });

  assert.ok(!email.html.includes(`${APP_URL}//`), "the origin's trailing slash leaked into a link");
  assert.ok(
    email.html.includes(`${APP_URL}${EMAIL_LOGO_PATH}`),
    "the logo URL is malformed by a trailing slash"
  );
});

test("the verification email shows the code and both things it proves", () => {
  const verification = RENDERED.find(([name]) => name === "company verification");
  assert.ok(verification);
  for (const fragment of ["482913", "Figma", "figma.com"]) {
    assert.ok(verification[1].html.includes(fragment), `the code email is missing ${fragment}`);
  }
});

test("each email links to the page its call to action belongs to", () => {
  const expectedLinks: Array<[name: string, href: string]> = [
    ["password reset", `${APP_URL}/reset-password?token=t1`],
    ["invitation", `${APP_URL}/signup?token=t2`],
    ["welcome", `${APP_URL}/dashboard`],
    ["resumed signup", `${APP_URL}/signup?resume=t3`],
    ["rejection", `${APP_URL}/`],
  ];

  for (const [name, href] of expectedLinks) {
    const email = RENDERED.find(([label]) => label === name);
    assert.ok(email, `no rendered email named ${name}`);
    assert.ok(email[1].html.includes(`href="${href}"`), `${name} email does not link to ${href}`);
  }
});
