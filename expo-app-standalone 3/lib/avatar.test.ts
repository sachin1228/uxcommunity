/**
 * Tests for the avatar fallback — the hash/palette contract is the whole
 * point of this port: the same member must wear the same color on both
 * clients, so the expected colors below are what the WEB app renders.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avatarBackground, nameInitials } from './avatar';

test('nameInitials reads the first and last word', () => {
  assert.equal(nameInitials('sachin patil'), 'SP');
  assert.equal(nameInitials('jack ma'), 'JM');
  assert.equal(nameInitials('Madonna'), 'M');
  assert.equal(nameInitials('  sachin   patil  '), 'SP');
  assert.equal(nameInitials('Sachin Patil Deshmukh'), 'SD');
  assert.equal(nameInitials(''), 'U');
  assert.equal(nameInitials(null), 'U');
  assert.equal(nameInitials(undefined), 'U');
});

test('avatarBackground reproduces the web colors exactly', () => {
  // Pinned against the web app (FNV-1a over the trimmed lowercase name):
  // "jack ma" is the purple every screenshot of the web profile shows.
  assert.equal(avatarBackground('jack ma'), '#8e4ec6');
  assert.equal(avatarBackground('  Jack Ma  '), '#8e4ec6', 'casing/padding must not move the color');
  assert.equal(avatarBackground('sachin patil'), '#0d8c7d');
  assert.equal(avatarBackground(''), '#da2f35', 'blank names share one fallback color');
});

test('the same name always maps to the same color', () => {
  for (const name of ['jack ma', 'sachin patil', 'ux community', 'Meera J']) {
    assert.equal(avatarBackground(name), avatarBackground(name));
  }
});
