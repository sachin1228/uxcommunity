import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FREE_EMAIL_DOMAINS,
  checkWorkEmail,
  domainFromEmail,
  isFreeEmailDomain,
  maskEmail,
  normalizeDomain,
} from "./domains";

/**
 * The domain is the trust signal behind a company on a profile, so what counts
 * as "the same domain" and what counts as a work email has to be unambiguous.
 * These tests pin both, because a mistake in either direction is a security
 * bug: too loose and two different companies share one company record, too
 * strict and a member cannot verify the company they actually work at.
 */

test("a domain is normalised to exactly one spelling", () => {
  // Everything that means figma.com must land on figma.com, otherwise the
  // company_domains uniqueness that stops two companies claiming one domain
  // would be defeated by casing or a trailing slash.
  for (const input of [
    "figma.com",
    "  Figma.com  ",
    "FIGMA.COM",
    "www.figma.com",
    "https://figma.com",
    "https://figma.com/",
    "http://www.figma.com/careers?ref=profile#jobs",
    "figma.com:443",
    "figma.com.",
    "sachin@figma.com",
  ]) {
    assert.equal(normalizeDomain(input), "figma.com", `expected ${input} → figma.com`);
  }
});

test("only real domains survive normalisation", () => {
  for (const input of ["", "   ", null, undefined, "figma", "figma.", ".com", "@", "figma..com", "https://", "-figma.com", "figma.c", "figma.c0m", "сachin@фигма.рф"]) {
    assert.equal(normalizeDomain(input), null, `expected ${String(input)} → null`);
  }
});

test("a domain can be read out of an email address", () => {
  assert.equal(domainFromEmail("Sachin@Figma.com"), "figma.com");
  assert.equal(domainFromEmail("sachin+work@figma.com"), "figma.com");
  assert.equal(domainFromEmail("sachin@mail.figma.com"), "mail.figma.com");
  // Two @, no local part, or no address at all is not an email.
  assert.equal(domainFromEmail("sachin@figma@com"), null);
  assert.equal(domainFromEmail("@figma.com"), null);
  assert.equal(domainFromEmail("sachin"), null);
  assert.equal(domainFromEmail(""), null);
});

test("personal providers can never verify a company", () => {
  for (const domain of FREE_EMAIL_DOMAINS) {
    assert.equal(isFreeEmailDomain(domain), true, `${domain} should be blocked`);
  }
  // Case and a leading www do not get around the list.
  assert.equal(isFreeEmailDomain("GMAIL.COM"), true);
  assert.equal(isFreeEmailDomain("www.gmail.com"), true);
  // A company domain is not blocked.
  assert.equal(isFreeEmailDomain("figma.com"), false);
  assert.equal(isFreeEmailDomain(null), false);
});

test("checkWorkEmail explains why a personal address is refused", () => {
  const personal = checkWorkEmail("sachin@gmail.com");
  assert.equal(personal.ok, false);
  assert.equal(personal.ok === false && personal.reason, "personal");
  assert.match(personal.ok === false ? personal.message : "", /work email/i);
  assert.equal(personal.ok === false && personal.domain, "gmail.com");

  const invalid = checkWorkEmail("sachin");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok === false && invalid.reason, "invalid");

  const work = checkWorkEmail(" Sachin@Figma.com ");
  assert.equal(work.ok, true);
  assert.equal(work.ok === true && work.domain, "figma.com");
});

test("the work email is only ever shown masked", () => {
  assert.equal(maskEmail("sachin@figma.com"), "s***n@figma.com");
  assert.equal(maskEmail("js@figma.com"), "j***@figma.com");
  assert.equal(maskEmail("a@figma.com"), "a***@figma.com");
  assert.equal(maskEmail(""), "");
});
