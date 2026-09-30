import assert from "node:assert/strict";
import { test } from "node:test";
import { emailPalettes } from "./theme";
import { EMAIL_LOGO_PATH } from "./layout";
import type { RenderedEmail } from "./document";
import {
  renderCompanyVerificationEmail,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderRejectionEmail,
  renderResumeSignupEmail,
  renderWelcomeEmail,
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
 *
 * Both bodies are checked. The plain-text part is the one that quietly rots,
 * because nothing in the product renders it and only the mail client does.
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

/** WCAG relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const PALETTE_TOKENS = ["page", "card", "heading", "text", "divider"] as const;

function paletteEntries(palette: typeof emailPalettes.light) {
  return PALETTE_TOKENS.map((token) => [token, palette[token]] as const);
}

test("every email inks the design system's light palette", () => {
  for (const [name, email] of RENDERED) {
    for (const [token, colour] of paletteEntries(emailPalettes.light)) {
      assert.ok(has(email.html, colour), `${name} email is missing the light ${token} colour ${colour}`);
    }
  }
});

test("every email carries the dark palette for a client that asks for it", () => {
  for (const [name, email] of RENDERED) {
    for (const [token, colour] of paletteEntries(emailPalettes.dark)) {
      assert.ok(has(email.html, colour), `${name} email is missing the dark ${token} colour ${colour}`);
    }
  }
});

test("every text and surface pair clears AA in both themes", () => {
  // The pairs a reader actually has to read: body copy and headings on the
  // card, the code in its well, and the labels on both actions. This is the
  // check that caught the dark body tone sitting at 3.67:1.
  for (const [scheme, palette] of Object.entries(emailPalettes)) {
    const pairs: Array<[what: string, foreground: string, background: string]> = [
      ["body copy", palette.text, palette.card],
      ["heading", palette.heading, palette.card],
      ["the code", palette.heading, palette.well],
      ["the primary action", palette.accentText, palette.accent],
      ["the quiet action", palette.secondaryText, palette.secondary],
    ];

    for (const [what, foreground, background] of pairs) {
      const measured = contrast(foreground, background);
      assert.ok(
        measured >= 4.5,
        `${scheme} ${what} (${foreground} on ${background}) measures ${measured.toFixed(2)}:1, under AA`
      );
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

test("every email is a complete document with a hidden preheader", () => {
  for (const [name, email] of RENDERED) {
    assert.ok(email.html.startsWith("<!DOCTYPE html>"), `${name} email is not a document`);
    assert.ok(email.html.trimEnd().endsWith("</html>"), `${name} email is not closed`);
    assert.ok(
      email.html.includes('content="light dark"'),
      `${name} email does not declare both colour schemes`
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

test("a primary call to action is the product's accent, inverted in dark", () => {
  for (const name of PRIMARY_ACTION_EMAILS) {
    const email = RENDERED.find(([label]) => label === name)?.[1];
    assert.ok(email, `no rendered email named ${name}`);
    assert.ok(
      has(email.html, `background-color:${emailPalettes.light.accent}`),
      `${name} email does not inline the light primary action`
    );
    assert.ok(email.html.includes('class="uxc-accent"'), `${name} email has no primary action hook`);
    assert.ok(
      has(email.html, `.uxc-accent { background-color: ${emailPalettes.dark.accent} !important; }`),
      `${name} email does not invert its primary action in dark`
    );
  }
});

test("the rejection email offers a quieter action than a primary one", () => {
  const rejection = RENDERED.find(([name]) => name === "rejection")?.[1];
  assert.ok(rejection, "no rendered rejection email");
  assert.ok(rejection.html.includes('class="uxc-secondary"'), "the rejection email has no quiet action");
  assert.ok(
    !rejection.html.includes('class="uxc-accent"'),
    "the rejection email should not lead with the primary action"
  );
});

test("the shell asks for both schemes and every dark rule beats the inline style", () => {
  for (const [name, email] of RENDERED) {
    assert.ok(email.html.includes("color-scheme: light dark"), `${name} email has no color-scheme`);

    const darkBlock =
      email.html.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const rules = darkBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith("}"));

    assert.ok(rules.length >= 10, `${name} email carries only ${rules.length} dark rules`);
    for (const rule of rules) {
      const declarations = rule
        .slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"))
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean);

      // Per declaration, not per rule: a rule where only the last property is
      // important leaves every earlier one losing to the inline style.
      for (const declaration of declarations) {
        assert.ok(
          declaration.endsWith("!important"),
          `${name} declaration would lose to the inline style: ${declaration}`
        );
      }
    }
  }
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
    const email = RENDERED.find(([label]) => label === name)?.[1];
    assert.ok(email, `no rendered email named ${name}`);
    assert.ok(email.html.includes(`href="${href}"`), `${name} email does not link to ${href}`);
    assert.ok(email.text.includes(href), `${name} text body does not link to ${href}`);
  }
});

test("every email has a plain-text body with no markup in it", () => {
  for (const [name, email] of RENDERED) {
    assert.ok(email.text.trim().length > 40, `${name} email has no text body`);
    assert.ok(
      !/<\/?[a-z][^>]*>/i.test(email.text),
      `${name} text body still carries HTML`
    );
    assert.ok(!email.text.includes("**"), `${name} text body leaked an emphasis marker`);
    assert.ok(!email.text.includes("&nbsp;"), `${name} text body leaked an entity`);
    assert.ok(
      email.text.includes(`© ${new Date().getFullYear()} uxcommunity`),
      `${name} text body has no footer`
    );
  }
});

test("the text body says what the heading and the blocks say", () => {
  for (const [name, email] of RENDERED) {
    const heading = email.html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1];
    assert.ok(heading, `${name} email has no heading`);
    assert.ok(
      email.text.startsWith(heading),
      `${name} text body does not open with its heading`
    );
  }

  const verification = RENDERED.find(([name]) => name === "company verification")?.[1];
  assert.ok(verification, "no rendered verification email");
  assert.ok(verification.text.includes("482913"), "the code is missing from the text body");
});

test("plain-text lines stay inside the width mail clients read at", () => {
  // A URL is allowed to run long: folding it would break the only thing the
  // reader has to act on.
  const overlong = (text: string) =>
    text
      .split("\n")
      .filter((line) => line.length > 78 && !line.includes("http"))
      .map((line) => `${line.length} cols: ${line}`);

  for (const [name, email] of RENDERED) {
    assert.deepEqual(overlong(email.text), [], `${name} text body has an overlong line`);
  }
});
