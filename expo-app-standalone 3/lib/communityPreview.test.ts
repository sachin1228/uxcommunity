/**
 * Tests for the chat-list preview — the mobile mirror of the web sidebar's
 * `sidebar-content.test.ts`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LastContent, LastMessage } from './communities';
import {
  contentIsNewerThanLastMessage,
  formatContentPreview,
  formatLastMessagePreview,
} from './communityPreview';

function message(overrides: Partial<LastMessage> = {}): LastMessage {
  return {
    id: 'm1',
    content: 'hi',
    created_at: '2026-09-17T10:00:00Z',
    user: { name: 'john doe' },
    is_reply: false,
    reply_to_user: null,
    ...overrides,
  };
}

test("preview uses the sender's first name", () => {
  assert.deepEqual(formatLastMessagePreview(message()), {
    prefix: 'john',
    text: 'hi',
  });
});

test('own messages preview as You', () => {
  assert.deepEqual(formatLastMessagePreview(message({ is_own: true })), {
    prefix: 'You',
    text: 'hi',
  });
});

test('a reply previews the person it answers', () => {
  assert.deepEqual(
    formatLastMessagePreview(
      message({ is_reply: true, reply_to_user: 'sachin' }),
    ),
    { prefix: 'john', text: 'replied to sachin: hi' },
  );
});

test('replying to your own message previews like a normal message', () => {
  assert.deepEqual(
    formatLastMessagePreview(
      message({ is_own: true, is_reply: true, reply_to_user: 'john' }),
    ),
    { prefix: 'You', text: 'hi' },
  );
});

test("another member's reply to their own message previews like a normal message", () => {
  // Every viewer sees "john: hi", not "john: replied to john: hi".
  assert.deepEqual(
    formatLastMessagePreview(
      message({ is_own: false, is_reply: true, reply_to_user: 'john' }),
    ),
    { prefix: 'john', text: 'hi' },
  );
});

test('an own reply to someone else still names them', () => {
  assert.deepEqual(
    formatLastMessagePreview(
      message({ is_own: true, is_reply: true, reply_to_user: 'sachin' }),
    ),
    { prefix: 'You', text: 'replied to sachin: hi' },
  );
});

test('an image-only message previews as a photo', () => {
  assert.deepEqual(
    formatLastMessagePreview(message({ content: '', has_image: true })),
    { prefix: 'john', text: '📷 Photo' },
  );
});

test('a captioned image previews its caption', () => {
  assert.deepEqual(
    formatLastMessagePreview(message({ content: 'look at this', has_image: true })),
    { prefix: 'john', text: 'look at this' },
  );
});

test('a deleted message never leaks its body', () => {
  assert.deepEqual(
    formatLastMessagePreview(message({ is_deleted: true })),
    { prefix: 'john', text: 'Message deleted' },
  );
});

function content(overrides: Partial<LastContent> = {}): LastContent {
  return {
    id: 'c1',
    kind: 'thread',
    created_at: '2026-09-17T11:00:00Z',
    isOwn: false,
    firstName: 'john',
    ...overrides,
  };
}

test('content previews name the author and the kind', () => {
  assert.deepEqual(formatContentPreview(content()), {
    prefix: 'john',
    text: 'created a thread',
  });
  assert.deepEqual(formatContentPreview(content({ kind: 'resource' })), {
    prefix: 'john',
    text: 'created a resource',
  });
});

test('own content previews as You', () => {
  assert.deepEqual(formatContentPreview(content({ isOwn: true, firstName: 'You' })), {
    prefix: 'You',
    text: 'created a thread',
  });
});

test('an unresolved author previews as Someone', () => {
  assert.deepEqual(formatContentPreview(content({ firstName: null })), {
    prefix: 'Someone',
    text: 'created a thread',
  });
});

test('vowel kinds take an', () => {
  assert.deepEqual(formatContentPreview(content({ kind: 'event' })), {
    prefix: 'john',
    text: 'created an event',
  });
});

test('content takes the preview only while newer than the last message', () => {
  assert.equal(
    contentIsNewerThanLastMessage(
      content({ created_at: '2026-09-17T11:00:00Z' }),
      { last_message: message({ created_at: '2026-09-17T10:00:00Z' }) },
    ),
    true,
  );
  assert.equal(
    contentIsNewerThanLastMessage(
      content({ created_at: '2026-09-17T09:00:00Z' }),
      { last_message: message({ created_at: '2026-09-17T10:00:00Z' }) },
    ),
    false,
  );
});
