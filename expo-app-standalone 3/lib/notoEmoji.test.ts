/**
 * Contract for the mobile Noto emoji asset layer (lib/notoEmoji.ts):
 *
 *  1. Asset keys match the web `emojiToCodepoint` output exactly — the same
 *     character must resolve to the same vendored SVG/Lottie file on both
 *     clients (variation selectors dropped, sequences joined with "_").
 *  2. Text splitting yields whole emoji clusters only — ZWJ sequences, skin
 *     tones and keycaps must never be cut into separate runs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emojiToCodepoint,
  lottieUrlForCodepoint,
  splitTextEmojiRuns,
  stripVS16,
  svgUrlForCodepoint,
} from './notoEmoji';

test('emojiToCodepoint mirrors the web keys', () => {
  assert.equal(emojiToCodepoint('😀'), '1f600');
  // Heart on fire: fe0f is dropped like the web helper does.
  assert.equal(emojiToCodepoint('❤️‍🔥'), '2764_200d_1f525');
  assert.equal(emojiToCodepoint('👍🏽'), '1f44d_1f3fd');
  assert.equal(emojiToCodepoint('👨‍👩‍👧'), '1f468_200d_1f469_200d_1f467');
  assert.equal(emojiToCodepoint('❤'), '2764');
  assert.equal(emojiToCodepoint(''), null);
});

test('variation selectors are stripped from asset URLs', () => {
  assert.equal(stripVS16('2764_fe0f_200d_1f525'), '2764_200d_1f525');
  assert.equal(svgUrlForCodepoint('2764_fe0f'), '/emoji/svg/emoji_u2764.svg');
  assert.equal(
    lottieUrlForCodepoint('2764_fe0f_200d_1f525'),
    '/emoji/lottie/2764_200d_1f525.json',
  );
});

test('text splitting keeps emoji clusters whole', () => {
  assert.deepEqual(splitTextEmojiRuns('hi 🎉 there'), [
    { kind: 'text', text: 'hi ' },
    { kind: 'emoji', text: '🎉' },
    { kind: 'text', text: ' there' },
  ]);

  const runs = splitTextEmojiRuns('👨‍👩‍👧👍🏽!');
  assert.deepEqual(
    runs.filter((run) => run.kind === 'emoji').map((run) => run.text),
    ['👨‍👩‍👧', '👍🏽'],
  );
  assert.equal(runs.at(-1)?.text, '!');

  assert.deepEqual(splitTextEmojiRuns('plain text'), [
    { kind: 'text', text: 'plain text' },
  ]);
});
