import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCommentBody,
  parseCompetitionEntryBody,
  parseCompetitionUpsertBody,
  parseVoteBody,
  slugifyCompetitionTitle,
} from "./validation";
import { DEFAULT_COMPETITION_RULES } from "./types";

const DESIGN = "https://media.example.com/competitions/week-04/design.webp";

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Weather, at a glance",
    description: "A forecast that answers what to wear.",
    cover_image_url: DESIGN,
    design_image_url: DESIGN,
    tools: ["Figma"],
    tags: ["mobile"],
    ...overrides,
  };
}

test("a valid entry parses, and the cover falls back to the main design", () => {
  const parsed = parseCompetitionEntryBody(
    { title: "Weather, at a glance", design_image_url: DESIGN, tools: ["Figma"], tags: [] },
    { requireDesigns: true },
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.coverImageUrl, DESIGN);
  assert.equal(parsed.value.designImageUrl, DESIGN);
  assert.deepEqual(parsed.value.tools, ["Figma"]);
  assert.equal(parsed.value.figmaUrl, null);
});

test("an entry without artwork is rejected — an empty gallery card is not an entry", () => {
  const parsed = parseCompetitionEntryBody(
    { title: "No artwork", description: "", tools: [], tags: [] },
    { requireDesigns: true },
  );
  assert.equal(parsed.ok, false);
});

test("titles are length-checked and URLs must be https", () => {
  assert.equal(
    parseCompetitionEntryBody(entryBody({ title: "no" }), { requireDesigns: true }).ok,
    false,
  );
  assert.equal(
    parseCompetitionEntryBody(entryBody({ title: "x".repeat(121) }), { requireDesigns: true }).ok,
    false,
  );

  // javascript: / data: / plain http can never reach the gallery.
  for (const url of ["javascript:alert(1)", "http://insecure.example.com/a.png", "data:image/png;base64,AAAA"]) {
    assert.equal(
      parseCompetitionEntryBody(entryBody({ design_image_url: url, cover_image_url: url }), {
        requireDesigns: true,
      }).ok,
      false,
      url,
    );
  }

  // A bare host without a dot is rejected for Figma/prototype links too.
  const parsed = parseCompetitionEntryBody(entryBody({ figma_url: "https://localhost" }), {
    requireDesigns: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.figmaUrl, null);
});

test("extra images are capped, typed, and de-duplicated tools are kept tidy", () => {
  const images = Array.from({ length: 3 }, (_, index) => ({
    name: `shot-${index}.png`,
    url: `${DESIGN}?${index}`,
    type: "image/png",
    size: 1024,
  }));

  const parsed = parseCompetitionEntryBody(
    entryBody({ image_urls: images, tools: ["Figma", "Figma", "After Effects"] }),
    { requireDesigns: true },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.imageUrls.length, 3);
  assert.deepEqual(parsed.value.tools, ["Figma", "After Effects"]);

  assert.equal(
    parseCompetitionEntryBody(entryBody({ image_urls: [...images, ...images, ...images] }), {
      requireDesigns: true,
    }).ok,
    false,
  );

  // Non-image attachments are refused.
  assert.equal(
    parseCompetitionEntryBody(
      entryBody({ image_urls: [{ name: "x", url: DESIGN, type: "application/pdf", size: 1 }] }),
      { requireDesigns: true },
    ).ok,
    false,
  );
});

test("the vote body is a strict boolean toggle", () => {
  assert.deepEqual(parseVoteBody({ active: true }), { ok: true, value: { active: true } });
  assert.deepEqual(parseVoteBody({ active: false }), { ok: true, value: { active: false } });
  assert.equal(parseVoteBody({ active: "yes" }).ok, false);
  assert.equal(parseVoteBody({}).ok, false);
});

test("comments require 1–1000 characters and a nullable parent", () => {
  const parsed = parseCommentBody({ body: "  lovely type  " });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.body, "lovely type");
    assert.equal(parsed.value.parentId, null);
  }

  assert.equal(parseCommentBody({ body: "   " }).ok, false);
  assert.equal(parseCommentBody({ body: "x".repeat(1001) }).ok, false);
});

test("slugify builds a URL-safe week slug", () => {
  assert.equal(slugifyCompetitionTitle("Design a Better Weather App"), "design-a-better-weather-app");
  assert.equal(slugifyCompetitionTitle("  Week 07 — Onboarding! "), "week-07-onboarding");
});

const CYCLE = {
  start_at: "2026-09-13T00:00:00.000Z",
  submission_deadline: "2026-09-18T18:00:00.000Z",
  voting_deadline: "2026-09-19T00:00:00.000Z",
  results_at: "2026-09-19T00:00:00.000Z",
};

test("the admin body keeps the cycle windows coherent", () => {
  const parsed = parseCompetitionUpsertBody({
    title: "Design a Better Weather App",
    week_number: 4,
    ...CYCLE,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.slug, "design-a-better-weather-app");
  // Configurable rules default to the standard set when none are given.
  assert.deepEqual(parsed.value.rules, DEFAULT_COMPETITION_RULES);
  assert.equal(parsed.value.maxEntriesPerUser, 1);
  assert.equal(parsed.value.votingRules.allow_self_vote, false);
  assert.equal(parsed.value.votingRules.one_vote_per_entry, true);

  // Out-of-order windows are refused rather than silently stored.
  const bad = parseCompetitionUpsertBody({
    title: "Backwards week",
    week_number: 5,
    ...CYCLE,
    submission_deadline: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(bad.ok, false);

  const missing = parseCompetitionUpsertBody({ title: "No dates", week_number: 5 });
  assert.equal(missing.ok, false);
});

test("admin rules and voting rules are configurable", () => {
  const parsed = parseCompetitionUpsertBody({
    title: "Configurable week",
    week_number: 8,
    rules: ["One entry each", "Be kind"],
    ...CYCLE,
    max_entries_per_user: 2,
    voting_rules: { allow_self_vote: true, allow_vote_removal: false, show_live_leaderboard: true },
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.rules, ["One entry each", "Be kind"]);
  assert.equal(parsed.value.maxEntriesPerUser, 2);
  assert.equal(parsed.value.votingRules.allow_self_vote, true);
  assert.equal(parsed.value.votingRules.allow_vote_removal, false);
  assert.equal(parsed.value.votingRules.show_live_leaderboard, true);

  // The MVP's one-vote-per-entry rule is not negotiable.
  const forced = parseCompetitionUpsertBody({
    title: "Multi-vote attempt",
    week_number: 9,
    ...CYCLE,
    voting_rules: { one_vote_per_entry: false },
  });
  assert.equal(forced.ok, true);
  if (forced.ok) assert.equal(forced.value.votingRules.one_vote_per_entry, true);

  // An entry cap outside 1–10 is rejected.
  assert.equal(
    parseCompetitionUpsertBody({
      title: "Too many entries",
      week_number: 10,
      ...CYCLE,
      max_entries_per_user: 50,
    }).ok,
    false,
  );
});
