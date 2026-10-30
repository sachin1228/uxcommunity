import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeLinkedInUrl,
  normalizePortfolioLinks,
  normalizeWorkSampleKeys,
  normalizeWorkSampleUrls,
} from "./rules";

test("LinkedIn accepts profile URLs on any linkedin.com subdomain", () => {
  assert.equal(
    normalizeLinkedInUrl("https://www.linkedin.com/in/ada"),
    "https://www.linkedin.com/in/ada",
  );
  assert.equal(
    normalizeLinkedInUrl("https://in.linkedin.com/in/ada"),
    "https://in.linkedin.com/in/ada",
  );
});

test("LinkedIn rejects other hosts and non-http schemes", () => {
  assert.equal(normalizeLinkedInUrl("https://example.com/in/ada"), null);
  assert.equal(normalizeLinkedInUrl("javascript:alert(1)"), null);
  assert.equal(normalizeLinkedInUrl(""), null);
});

test("portfolio needs one or two valid links", () => {
  const one = normalizePortfolioLinks(["https://notion.site/ada"]);
  assert.equal(one.error, null);
  assert.deepEqual(one.links, ["https://notion.site/ada"]);

  const two = normalizePortfolioLinks([
    "https://docs.google.com/document/d/abc",
    "https://ada.design",
  ]);
  assert.equal(two.error, null);
  assert.equal(two.links.length, 2);

  assert.match(normalizePortfolioLinks([]).error ?? "", /at least one/);
  assert.match(
    normalizePortfolioLinks(["https://a.design", "https://b.design", "https://c.design"]).error ?? "",
    /at most 2/,
  );
  assert.match(normalizePortfolioLinks(["not a url"]).error ?? "", /valid URL/);
});

test("work samples are optional and capped at three", () => {
  assert.deepEqual(normalizeWorkSampleUrls(undefined), { urls: [], error: null });

  const three = normalizeWorkSampleUrls([
    "https://media.example/1.webp",
    "https://media.example/2.webp",
    "https://media.example/3.webp",
  ]);
  assert.equal(three.error, null);
  assert.equal(three.urls.length, 3);

  assert.match(
    normalizeWorkSampleUrls([
      "https://media.example/1.webp",
      "https://media.example/2.webp",
      "https://media.example/3.webp",
      "https://media.example/4.webp",
    ]).error ?? "",
    /at most 3/,
  );
  assert.match(normalizeWorkSampleUrls(["nope"]).error ?? "", /valid image URL/);
});

test("work-sample keys are private object paths, not URLs", () => {
  const ok = normalizeWorkSampleKeys([
    "verification/u1/0d1f8d1e-1111-4111-8111-111111111111.webp",
    "verification/u1/0d1f8d1e-2222-4222-8222-222222222222.webp",
  ]);
  assert.equal(ok.error, null);
  assert.equal(ok.keys.length, 2);

  assert.match(normalizeWorkSampleKeys(["https://media.example/x.webp"]).error ?? "", /valid upload/);
  assert.match(normalizeWorkSampleKeys(["/verification/u1/x.webp"]).error ?? "", /valid upload/);
  assert.match(normalizeWorkSampleKeys(["verification/u1/../x.webp"]).error ?? "", /valid upload/);
  assert.match(
    normalizeWorkSampleKeys([
      "verification/u1/1.webp",
      "verification/u1/2.webp",
      "verification/u1/3.webp",
      "verification/u1/4.webp",
    ]).error ?? "",
    /at most 3/,
  );
  assert.deepEqual(normalizeWorkSampleKeys(null), { keys: [], error: null });
});

test("legacy work-sample URLs still validate during migration", () => {
  const legacy = normalizeWorkSampleUrls(["https://media.example/x.webp"]);
  assert.equal(legacy.error, null);
  assert.equal(legacy.urls.length, 1);
});
