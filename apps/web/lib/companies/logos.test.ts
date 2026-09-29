import assert from "node:assert/strict";
import { test } from "node:test";
import { companyLogoUrl, logoUrlForDomain } from "./logos";

/**
 * A logo is decoration, but it is decoration that ends up on a profile next to
 * a verified domain, so these tests pin the two things that could go wrong:
 * a stored image has to win, and a domain-derived logo has to be built from the
 * NORMALISED domain (otherwise `www.figma.com` and `figma.com` would be two
 * different icons, and a pasted URL would be handed to the provider verbatim).
 */

test("a stored logo always beats the domain-derived one", () => {
  assert.equal(
    companyLogoUrl("https://assets.example.com/figma.png", "figma.com"),
    "https://assets.example.com/figma.png"
  );
});

test("no stored logo falls back to the domain", () => {
  assert.equal(companyLogoUrl(null, "figma.com"), logoUrlForDomain("figma.com"));
  assert.equal(companyLogoUrl("", "figma.com"), logoUrlForDomain("figma.com"));
  assert.equal(companyLogoUrl("   ", "figma.com"), logoUrlForDomain("figma.com"));
});

test("a domain-derived logo carries the normalised domain", () => {
  const url = logoUrlForDomain("  HTTPS://www.Figma.com/careers  ");
  assert.ok(url, "expected a URL for a valid domain");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("domain"), "figma.com");
  assert.ok(parsed.searchParams.get("sz"), "expected the size parameter to be present");
});

test("a consumer mailbox domain never gets an icon", () => {
  // A free-email domain cannot verify a company, so it must never be able to
  // put that provider's mark next to one either.
  assert.equal(logoUrlForDomain("gmail.com"), null);
  assert.equal(logoUrlForDomain("yahoo.co.in"), null);
  assert.equal(companyLogoUrl(null, "gmail.com"), null);
});

test("there is no logo without a usable domain", () => {
  // A company a member has just created has no domain yet, and a template that
  // hands the provider an empty `domain=` would put somebody else's mark on it.
  for (const input of [null, undefined, "", "   ", "not a domain", "sachin@", "gmail"]) {
    assert.equal(logoUrlForDomain(input), null, `expected no logo for ${JSON.stringify(input)}`);
  }
  assert.equal(companyLogoUrl(null, null), null);
});
