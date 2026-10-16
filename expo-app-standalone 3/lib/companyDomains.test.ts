/**
 * Tests for the company work-email policy — ported from the web app's
 * `lib/companies/domains.test.ts` so both clients agree on what counts as
 * "the same domain" and what counts as a work email. A mistake in either
 * direction is a security bug, hence the same cases pinned on both sides.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FREE_EMAIL_DOMAINS,
  checkWorkEmail,
  companyNameMatchesDomain,
  companyNamesMatch,
  domainFromEmail,
  isFreeEmailDomain,
  normalizeDomain,
  suggestedCompanyName,
} from './companyDomains';

test('a domain is normalised to exactly one spelling', () => {
  for (const input of [
    'figma.com',
    '  Figma.com  ',
    'FIGMA.COM',
    'www.figma.com',
    'https://figma.com',
    'https://figma.com/',
    'http://www.figma.com/careers?ref=profile#jobs',
    'figma.com:443',
    'figma.com.',
    'sachin@figma.com',
  ]) {
    assert.equal(normalizeDomain(input), 'figma.com', `expected ${input} → figma.com`);
  }
});

test('only real domains survive normalisation', () => {
  for (const input of ['', '   ', null, undefined, 'figma', 'figma.', '.com', '@', 'figma..com', 'https://', '-figma.com', 'figma.c', 'figma.c0m', 'сachin@фигма.рф']) {
    assert.equal(normalizeDomain(input), null, `expected ${String(input)} → null`);
  }
});

test('a domain can be read out of an email address', () => {
  assert.equal(domainFromEmail('Sachin@Figma.com'), 'figma.com');
  assert.equal(domainFromEmail('sachin+work@figma.com'), 'figma.com');
  assert.equal(domainFromEmail('sachin@mail.figma.com'), 'mail.figma.com');
  // Two @, no local part, or no address at all is not an email.
  assert.equal(domainFromEmail('sachin@figma@com'), null);
  assert.equal(domainFromEmail('@figma.com'), null);
  assert.equal(domainFromEmail('sachin'), null);
  assert.equal(domainFromEmail(''), null);
});

test('personal providers can never verify a company', () => {
  for (const domain of FREE_EMAIL_DOMAINS) {
    assert.equal(isFreeEmailDomain(domain), true, `${domain} should be blocked`);
  }
  assert.equal(isFreeEmailDomain('GMAIL.COM'), true);
  assert.equal(isFreeEmailDomain('www.gmail.com'), true);
  assert.equal(isFreeEmailDomain('figma.com'), false);
  assert.equal(isFreeEmailDomain(null), false);
});

test('checkWorkEmail explains why a personal address is refused', () => {
  const personal = checkWorkEmail('sachin@gmail.com');
  assert.equal(personal.ok, false);
  assert.equal(personal.ok === false && personal.reason, 'personal');
  assert.match(personal.ok === false ? personal.message : '', /work email/i);
  assert.equal(personal.ok === false && personal.domain, 'gmail.com');

  const invalid = checkWorkEmail('sachin');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok === false && invalid.reason, 'invalid');

  const work = checkWorkEmail(' Sachin@Figma.com ');
  assert.equal(work.ok, true);
  assert.equal(work.ok === true && work.domain, 'figma.com');
});

test('a company name has to correspond to the domain it proves', () => {
  const accepted: [string, string][] = [
    ['Figma', 'figma.com'],
    ['Figma', 'FIGMA.COM'],
    ['Labsmart', 'labsmart.co.in'],
    ['Labsmart Technologies Pvt Ltd', 'labsmart.in'],
    ['Google India', 'google.com'],
    ['Acme Labs', 'acme-labs.com'],
    ['Tata Consultancy Services', 'tcs.com'],
    ['TCS', 'tcs.com'],
    ['FB', 'fb.com'],
    ['X', 'x.com'],
    ['Swiggy', 'swiggy.in'],
    ['Swiggy Foods', 'swiggy.com'],
  ];

  for (const [name, domain] of accepted) {
    assert.equal(companyNameMatchesDomain(name, domain).ok, true, `${name} + ${domain}`);
  }

  const refused: [string, string][] = [
    ['labsmart', 'google.com'],
    ['Microsoft', 'acme.com'],
    ['Meera Design Co', 'figma.com'],
    ['Acme', 'randomcompany.com'],
    ['', 'figma.com'],
    ['Figma', ''],
  ];

  for (const [name, domain] of refused) {
    const result = companyNameMatchesDomain(name, domain);
    assert.equal(result.ok, false, `${name} + ${domain} should be refused`);
  }

  // The refusal carries the label so the UI can suggest the matching name.
  assert.equal(companyNameMatchesDomain('Microsoft', 'acme-labs.com').label, 'acme');
  assert.equal(suggestedCompanyName('labsmart.co.in'), 'Labsmart');
  assert.equal(suggestedCompanyName('tcs.com'), 'Tcs');
});

test('the same company under a different spelling is the same name', () => {
  for (const typed of ['zomato', 'Zomato', 'ZOMATO', ' Zomato ', 'Zomato,', 'Zomato Inc', 'Zomato, Inc.', 'The Zomato', 'Zomato pvt ltd']) {
    assert.equal(companyNamesMatch(typed, 'Zomato'), true, `${typed} is Zomato`);
  }

  for (const typed of ['Zomatos', 'Zomato Labs', 'Zomatoo', 'Zomato Technologies', '', 'Inc', 'Ltd']) {
    assert.equal(companyNamesMatch(typed, 'Zomato'), false, `${typed} is not Zomato`);
  }

  assert.equal(companyNamesMatch('Figma Inc', 'Canva Inc'), false);
  assert.equal(companyNamesMatch('Figma,', 'Figma Inc.'), true);
});
