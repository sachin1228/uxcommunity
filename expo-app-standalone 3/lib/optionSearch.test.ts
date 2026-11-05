import assert from 'node:assert/strict';
import test from 'node:test';

import { matchScore, normalizeSearchText, rankOptions } from './optionSearch';

const catalog = [
  { name: 'Amsterdam' },
  { name: 'Bengaluru', aliases: ['Bangalore', 'Bengalooru'] },
  { name: 'Chennai', aliases: ['Madras'] },
  { name: 'Delhi', aliases: ['New Delhi', 'Dilli'] },
  { name: 'Gurugram', aliases: ['Gurgaon'] },
  { name: 'Los Angeles', aliases: ['LA'] },
  { name: 'Mumbai', aliases: ['Bombay'] },
  { name: 'New York City', aliases: ['New York', 'NYC'] },
  { name: 'Pune' },
  { name: 'San Francisco', aliases: ['SF', 'San Fran'] },
  { name: 'Sao Paulo' },
];

const names = (query: string) => rankOptions(catalog, query).map((city) => city.name);

test('normalizes case, diacritics and punctuation', () => {
  assert.equal(normalizeSearchText('São Paulo'), 'sao paulo');
  assert.equal(normalizeSearchText('Washington, D.C.'), 'washington d c');
  assert.equal(normalizeSearchText('  New   Delhi '), 'new delhi');
});

test('finds a city by its alternate name', () => {
  assert.deepEqual(names('Bangalore'), ['Bengaluru']);
  assert.deepEqual(names('Bombay'), ['Mumbai']);
  assert.deepEqual(names('Gurgaon'), ['Gurugram']);
  assert.deepEqual(names('Madras'), ['Chennai']);
});

test('finds a multi-word alias and abbreviation', () => {
  assert.deepEqual(names('new delhi'), ['Delhi']);
  assert.deepEqual(names('NYC'), ['New York City']);
  assert.deepEqual(names('SF'), ['San Francisco']);
});

test('tolerates typos', () => {
  assert.ok(names('Banglore').includes('Bengaluru'));
  assert.ok(names('Bengalru').includes('Bengaluru'));
  assert.ok(names('Bombey').includes('Mumbai'));
});

test('ranks exact and prefix matches above fuzzy ones', () => {
  const ranked = rankOptions(
    [{ name: 'Oslo' }, { name: 'Lagos' }, { name: 'Los Angeles', aliases: ['LA'] }],
    'la',
  );
  assert.deepEqual(ranked.map((city) => city.name), ['Los Angeles', 'Lagos']);
});

test('matches a word inside a multi-word name', () => {
  assert.ok(names('york').includes('New York City'));
});

test('ignores diacritics in the query', () => {
  assert.deepEqual(names('sao paulo'), ['Sao Paulo']);
  assert.deepEqual(names('São Paulo'), ['Sao Paulo']);
});

test('returns no matches instead of weak guesses', () => {
  assert.deepEqual(names('zzzz'), []);
  assert.equal(matchScore({ name: 'Pune' }, 'zzzz'), null);
});

test('keeps the catalog order for an empty query', () => {
  assert.deepEqual(
    rankOptions(catalog, '  ').map((city) => city.name),
    catalog.map((city) => city.name),
  );
});

test('keeps catalog order among equally scored matches', () => {
  const ranked = rankOptions([{ name: 'Pune' }, { name: 'Puebla' }], 'pu');
  assert.deepEqual(ranked.map((city) => city.name), ['Pune', 'Puebla']);
});
