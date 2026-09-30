import { emailPalettes, emailTheme as theme } from "./theme";
import { renderEmailHtml } from "./layout";
import { renderEmailText } from "./text";

/**
 * One description of an email, rendered into both bodies a send needs.
 *
 * Writing the plain-text part by hand is how it becomes a stale copy of the
 * HTML: nothing fails when the two disagree, and a client that strips HTML is
 * exactly where the disagreement shows. So a template states its content once —
 * heading, blocks, small print — and each renderer walks the same blocks. The
 * text part also improves the odds a filter scores the mail as a real message
 * rather than as a body with no words in it.
 */

/** The pieces a template is built from. */
export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; value: string }
  | { kind: "action"; label: string; href: string; variant?: "primary" | "secondary" }
  | { kind: "finePrint"; text: string };

export interface EmailDocument {
  appUrl: string;
  subject: string;
  /** Inbox preview line — shown beside the subject, hidden inside the body. */
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Emphasis is authored as `**bold**` because the two renderers spell it
 * differently: a run of `<strong>` in HTML, and nothing at all in text, which
 * has no way to say it.
 */
const EMPHASIS = /\*\*([^*]+)\*\*/g;

/**
 * `**bold**` as the HTML the layout can style. It carries the heading class as
 * well, because the colour it stands out with is the themed one.
 */
export function emphasizeHtml(text: string): string {
  return text.replace(
    EMPHASIS,
    `<strong class="uxc-heading" style="color:${emailPalettes.light.heading};font-weight:${theme.weight.semibold};">$1</strong>`
  );
}

/** `**bold**` as plain text, which carries the words and drops the marker. */
export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, "$1");
}

export function renderEmail(document: EmailDocument): RenderedEmail {
  return {
    subject: document.subject,
    html: renderEmailHtml(document),
    text: renderEmailText(document),
  };
}
