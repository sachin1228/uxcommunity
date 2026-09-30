import { APP_NAME } from "@uxcommunity/shared";
import { emphasizeHtml, type EmailBlock, type EmailDocument } from "./document";
import { emailTheme as theme } from "./theme";

/**
 * The HTML body: one shell and one renderer per block kind.
 *
 * Keeping a single shell is what makes a change of brand a change in one place —
 * before this, six templates each carried their own copy of the header and the
 * footer, and the palette in them had already drifted away from the product.
 */

/**
 * The brand mark the emails carry, served from the web app's `public`
 * directory.
 *
 * It is the same artwork as the in-app logo mark, as a raster: no email client
 * renders the inline SVG the app draws, and PNG is the one format all of them
 * agree on. The file is a rounded tile that is transparent outside its corners,
 * so it sits on the dark card without a plate behind it.
 */
export const EMAIL_LOGO_PATH = "/icons/icon-512.png";

/** Absolute URL of the brand mark, addressed from the app's own origin. */
export function emailLogoUrl(appUrl: string): string {
  return `${stripTrailingSlash(appUrl)}${EMAIL_LOGO_PATH}`;
}

/** Join a path onto the app's origin, however that origin is spelled. */
export function appLink(appUrl: string, path = "/"): string {
  return `${stripTrailingSlash(appUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** A bulletproof call to action: the background lives on the cell, not the link. */
function actionBlock(block: Extract<EmailBlock, { kind: "action" }>): string {
  const primary = (block.variant ?? "primary") === "primary";
  const background = primary ? theme.accent : theme.secondary;
  const color = primary ? theme.accentText : theme.secondaryText;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background-color:${background};border-radius:${theme.radius.button};">
      <a href="${block.href}" style="display:inline-block;padding:13px 26px;font-family:${theme.font};font-size:${theme.size.body};font-weight:${theme.weight.semibold};line-height:1;color:${color};text-decoration:none;border-radius:${theme.radius.button};">${block.label}</a>
    </td>
  </tr>
</table>`;
}

/**
 * The one-time code, in a sunken well.
 *
 * The letterspacing is part of the security story, not decoration: it makes the
 * digits easy to read one at a time when retyping them by hand.
 */
function codeBlock(block: Extract<EmailBlock, { kind: "code" }>): string {
  return `<p style="margin:0 0 16px;padding:18px 20px;background-color:${theme.well};border-radius:${theme.radius.well};font-family:${theme.font};font-size:${theme.size.code};font-weight:${theme.weight.semibold};letter-spacing:0.26em;line-height:${theme.leading.tight};color:${theme.heading};text-align:center;">${block.value}</p>`;
}

/**
 * A paragraph sits close to the text it belongs with, and opens a wider gap
 * before a call to action — a button or the code well. The space comes from the
 * paragraph because a margin on the element itself is unreliable in Outlook's
 * renderer.
 */
function paragraphBlock(
  block: Extract<EmailBlock, { kind: "paragraph" }>,
  next: EmailBlock | undefined
): string {
  const spaced = next?.kind === "action" || next?.kind === "code";
  const margin = spaced ? "0 0 26px" : "0 0 14px";

  return `<p style="margin:${margin};font-family:${theme.font};font-size:${theme.size.body};line-height:${theme.leading.relaxed};color:${theme.text};">${emphasizeHtml(block.text)}</p>`;
}

/** The small print under a call to action. */
function finePrintBlock(block: Extract<EmailBlock, { kind: "finePrint" }>): string {
  return `<p style="margin:22px 0 0;font-family:${theme.font};font-size:${theme.size.small};line-height:${theme.leading.normal};color:${theme.text};">${emphasizeHtml(block.text)}</p>`;
}

function renderBlock(block: EmailBlock, next: EmailBlock | undefined): string {
  switch (block.kind) {
    case "paragraph":
      return paragraphBlock(block, next);
    case "code":
      return codeBlock(block);
    case "action":
      return actionBlock(block);
    case "finePrint":
      return finePrintBlock(block);
  }
}

export function renderEmailHtml(document: EmailDocument): string {
  const { appUrl, subject, preheader, heading, blocks } = document;
  const origin = appLink(appUrl);
  const year = new Date().getFullYear();
  const content = blocks
    .map((block, index) => renderBlock(block, blocks[index + 1]))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${theme.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${theme.page};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${theme.page};">
  <tr>
    <td align="center" style="padding:44px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:${theme.card};border-radius:${theme.radius.card};">
        <tr>
          <td style="padding:30px 36px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:0 10px 0 0;vertical-align:middle;">
                  <a href="${origin}" style="text-decoration:none;">
                    <img src="${emailLogoUrl(appUrl)}" width="40" height="40" alt="${APP_NAME}" style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;" />
                  </a>
                </td>
                <td style="vertical-align:middle;">
                  <a href="${origin}" style="font-family:${theme.font};font-size:${theme.size.wordmark};font-weight:${theme.weight.semibold};letter-spacing:-0.02em;line-height:1;color:${theme.heading};text-decoration:none;">${APP_NAME}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 36px 34px;">
            <h1 style="margin:0 0 14px;font-family:${theme.font};font-size:${theme.size.title};font-weight:${theme.weight.semibold};letter-spacing:-0.02em;line-height:${theme.leading.tight};color:${theme.heading};">${heading}</h1>
${content}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 26px;border-top:1px solid ${theme.divider};">
            <p style="margin:0;font-family:${theme.font};font-size:${theme.size.small};line-height:${theme.leading.normal};color:${theme.text};">© ${year} ${APP_NAME}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
