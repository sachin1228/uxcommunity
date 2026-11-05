import assert from "node:assert/strict";
import { test } from "node:test";
import { matchScore, normalizeSearchText, rankOptions } from "./option-search";

const catalog = [
  { label: "Amsterdam" },
  { label: "Bengaluru", aliases: ["Bangalore", "Bengalooru"] },
  { label: "Chennai", aliases: ["Madras"] },
  { label: "Delhi", aliases: ["New Delhi", "Dilli"] },
  { label: "Gurugram", aliases: ["Gurgaon"] },
  { label: "Los Angeles", aliases: ["LA"] },
  { label: "Mumbai", aliases: ["Bombay"] },
  { label: "New York City", aliases: ["New York", "NYC"] },
  { label: "Pune" },
  { label: "San Francisco", aliases: ["SF", "San Fran"] },
  { label: "Sao Paulo" },
];

const labels = (query: string) => rankOptions(catalog, query).map((city) => city.label);

test("normalizes case, diacritics and punctuation", () => {
  assert.equal(normalizeSearchText("São Paulo"), "sao paulo");
  assert.equal(normalizeSearchText("Washington, D.C."), "washington d c");
  assert.equal(normalizeSearchText("  New   Delhi "), "new delhi");
});

test("finds a city by its alternate name", () => {
  assert.deepEqual(labels("Bangalore"), ["Bengaluru"]);
  assert.deepEqual(labels("Bombay"), ["Mumbai"]);
  assert.deepEqual(labels("Gurgaon"), ["Gurugram"]);
  assert.deepEqual(labels("Madras"), ["Chennai"]);
});

test("finds a multi-word alias and abbreviation", () => {
  assert.deepEqual(labels("new delhi"), ["Delhi"]);
  assert.deepEqual(labels("NYC"), ["New York City"]);
  assert.deepEqual(labels("SF"), ["San Francisco"]);
});

test("tolerates typos", () => {
  assert.ok(labels("Banglore").includes("Bengaluru"));
  assert.ok(labels("Bengalru").includes("Bengaluru"));
  assert.ok(labels("Bombey").includes("Mumbai"));
});

test("ranks exact and prefix matches above fuzzy ones", () => {
  const ranked = rankOptions(
    [
      { label: "Oslo" },
      { label: "Lagos" },
      { label: "Los Angeles", aliases: ["LA"] },
    ],
    "la",
  );
  assert.deepEqual(ranked.map((city) => city.label), ["Los Angeles", "Lagos"]);
});

test("matches a word inside a multi-word name", () => {
  assert.ok(labels("york").includes("New York City"));
});

test("ignores diacritics in the query", () => {
  assert.deepEqual(labels("sao paulo"), ["Sao Paulo"]);
  assert.deepEqual(labels("São Paulo"), ["Sao Paulo"]);
});

test("returns no matches instead of weak guesses", () => {
  assert.deepEqual(labels("zzzz"), []);
  assert.equal(matchScore({ label: "Pune" }, "zzzz"), null);
});

test("keeps the catalog order for an empty query", () => {
  assert.deepEqual(
    rankOptions(catalog, "  ").map((city) => city.label),
    catalog.map((city) => city.label),
  );
});

test("keeps catalog order among equally scored matches", () => {
  const ranked = rankOptions(
    [
      { label: "Pune" },
      { label: "Puebla" },
    ],
    "pu",
  );
  assert.deepEqual(ranked.map((city) => city.label), ["Pune", "Puebla"]);
});
