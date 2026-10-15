/**
 * Tests for the pure jobs module — the board tab rules, search, apply-form
 * validation and the payload presentation helpers shared with the web.
 *
 * `hooks`, screens and `lib/jobsApi.ts` import React Native / the API client
 * and cannot run on the CI runner, so the policy they apply is tested here
 * against the module they all use.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  criteriaMismatches,
  experienceYearsLabel,
  listPhrase,
  resumeFileIssue,
  richTextToPlain,
  searchJobs,
  splitJobsByTab,
  validateApplyForm,
  type JobPost,
} from './jobs';

/** A complete-enough JobPost for the pure rules — overridable per test. */
function job(overrides: Partial<JobPost> = {}): JobPost {
  return {
    id: 'j1',
    kind: 'hiring',
    title: 'Product Designer',
    description: '',
    responsibilities: [],
    requirements: [],
    skills: [],
    salary: null,
    website: null,
    work_mode: 'remote',
    employment_type: 'full_time',
    city_id: null,
    city_name: 'All cities',
    sector_id: null,
    sector_name: 'All sectors',
    job_title: 'Product Designer',
    job_title_label: 'Product Designer',
    experience_level: 'mid',
    experience_level_label: 'Mid-level Designers (3-5 years)',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'open',
    updated_at: null,
    closes_at: null,
    company: {
      id: 'c1',
      name: 'Acme',
      slug: 'acme',
      logo_url: null,
      domain: null,
      domain_verified: false,
    },
    poster: {
      id: 'u1',
      name: 'Ada',
      avatar_url: null,
      job_title: null,
      job_title_label: null,
      experience_level: null,
      experience_level_label: null,
      company_name: null,
    },
    applicant_count: 0,
    criteria_locked: false,
    applied: false,
    is_mine: false,
    can_apply: true,
    my_application: null,
    posted_label: 'Just now',
    updated_label: null,
    deadline_label: null,
    deadline_expired: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Board tabs
// ---------------------------------------------------------------------------

test('browse tabs show only matching roles; own and applied go to their tabs', () => {
  const hiring = job({ id: 'hiring' });
  const referral = job({ id: 'referral', kind: 'referral' });
  const mine = job({ id: 'mine', is_mine: true });
  const applied = job({ id: 'applied', applied: true });
  const locked = job({ id: 'locked', can_apply: false });

  const tabs = splitJobsByTab([hiring, referral, mine, applied, locked]);

  assert.deepEqual(tabs.hiring.map((j) => j.id), ['hiring']);
  assert.deepEqual(tabs.referral.map((j) => j.id), ['referral']);
  assert.deepEqual(tabs.applied.map((j) => j.id), ['applied']);
  assert.deepEqual(tabs.myPosts.map((j) => j.id), ['mine']);
  // A role the profile does not match appears nowhere on the browse tabs.
  assert.ok(!tabs.hiring.some((j) => j.id === 'locked'));
});

test('an applied role leaves the browse tabs even when it still can_apply', () => {
  const applied = job({ applied: true, can_apply: true });
  const tabs = splitJobsByTab([applied]);
  assert.equal(tabs.hiring.length, 0);
  assert.equal(tabs.applied.length, 1);
});

test('my own post never appears on a browse tab, even when open', () => {
  const mine = job({ is_mine: true, can_apply: false });
  const tabs = splitJobsByTab([mine]);
  assert.equal(tabs.hiring.length, 0);
  assert.equal(tabs.myPosts.length, 1);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test('searches title, company name and skills case-insensitively', () => {
  const jobs = [
    job({ id: 'a', title: 'Product Designer' }),
    job({ id: 'b', title: 'Brand Designer', company: { ...job().company, name: 'Northwind' } }),
    job({ id: 'c', title: 'Design Engineer', skills: ['Figma', 'React Native'] }),
  ];

  assert.deepEqual(searchJobs(jobs, 'designer').map((j) => j.id), ['a', 'b']);
  assert.deepEqual(searchJobs(jobs, 'northwind').map((j) => j.id), ['b']);
  assert.deepEqual(searchJobs(jobs, 'FIGMA').map((j) => j.id), ['c']);
  assert.deepEqual(searchJobs(jobs, 'missing').map((j) => j.id), []);
  assert.equal(searchJobs(jobs, '   ').length, 3);
});

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

test('experienceYearsLabel extracts the parenthetical, else falls back', () => {
  assert.equal(experienceYearsLabel('Mid-level Designers (3-5 years)'), '(3-5 years)');
  assert.equal(experienceYearsLabel('Senior Designers'), 'Senior Designers');
});

test('richTextToPlain flattens the description like the web RichText shows it', () => {
  const html =
    '<h2>About</h2><p>We build <strong>things</strong>.</p><ul><li>Ship fast</li><li>Care &amp; share</li></ul><p>Line<br>break</p>';
  // The blank line is the list-close boundary — block structure survives.
  assert.equal(
    richTextToPlain(html),
    'About\nWe build things.\n- Ship fast\n- Care & share\n\nLine\nbreak',
  );
});

test('criteriaMismatches names only the gating dimensions (NULL = All never mismatches)', () => {
  const target = job({
    city_id: null,
    sector_id: 's1',
    job_title: 'Product Designer',
    experience_level: 'mid',
  });

  assert.deepEqual(
    criteriaMismatches(target, {
      cityId: null,
      sectorId: 's2',
      jobTitle: 'Brand Designer',
      experienceLevel: 'mid',
    }),
    ['sector', 'job title'],
  );

  assert.deepEqual(
    criteriaMismatches(target, {
      cityId: null,
      sectorId: 's1',
      jobTitle: 'Product Designer',
      experienceLevel: 'mid',
    }),
    [],
  );
});

test('listPhrase joins like the web lock copy', () => {
  assert.equal(listPhrase([]), '');
  assert.equal(listPhrase(['city']), 'city');
  assert.equal(listPhrase(['city', 'sector']), 'city and sector');
  assert.equal(listPhrase(['city', 'sector', 'job title']), 'city, sector and job title');
});

// ---------------------------------------------------------------------------
// Apply-form validation
// ---------------------------------------------------------------------------

test('accepts a well-formed application', () => {
  assert.deepEqual(
    validateApplyForm({
      name: 'Ada Lovelace',
      portfolioUrl: 'https://ada.example.com',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    }),
    {},
  );
});

test('rejects short names, non-http URLs and non-LinkedIn URLs', () => {
  const errors = validateApplyForm({
    name: 'A',
    portfolioUrl: 'ftp://example.com',
    linkedinUrl: 'https://example.com/in/ada',
  });

  assert.ok(errors.name);
  assert.ok(errors.portfolioUrl);
  assert.ok(errors.linkedinUrl);
});

test('resume pre-checks mirror the server limits', () => {
  assert.equal(resumeFileIssue('application/pdf', 1024), null);
  assert.equal(resumeFileIssue(null, 1024), null, 'unknown MIME defers to the server');
  assert.equal(resumeFileIssue('application/pdf', 6 * 1024 * 1024), 'resume_too_large');
  assert.equal(resumeFileIssue('image/png', 1024), 'resume_bad_type');
});
