/**
 * Regression tests for production-readiness audit M-7 (JWT in query parameters)
 * on the Expo client.
 *
 * The mobile app used to append the 7-day session JWT as `?token=` because
 * React Native's WebSocket cannot set arbitrary headers the standard way. It can
 * send headers through its non-standard third constructor argument, so the JWT
 * now travels in the handshake `Cookie` header and the URL carries only `room`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RealtimeClient,
  SESSION_COOKIE_NAME,
  buildRealtimeSocketUrl,
  sessionCookieHeaders,
  type RealtimePlatform,
  type RealtimeSocket,
} from './realtimeCore';

test('the socket URL carries only the room — never a token (audit M-7)', () => {
  const url = buildRealtimeSocketUrl('https://rt.example.com', 'chat:community-1');

  assert.equal(url, 'wss://rt.example.com/ws?room=chat%3Acommunity-1');
  assert.ok(!/[?&]token=/.test(url), 'no token parameter may be present');
});

test('sessionCookieHeaders builds the cookie, or nothing without a token', () => {
  assert.deepEqual(sessionCookieHeaders('jwt-abc'), {
    Cookie: `${SESSION_COOKIE_NAME}=jwt-abc`,
  });
  assert.equal(sessionCookieHeaders(null), undefined);
  assert.equal(sessionCookieHeaders(''), undefined);
  assert.equal(sessionCookieHeaders(undefined), undefined);
});

/** Fake platform that records how the core opens sockets. */
class RecordingPlatform implements RealtimePlatform {
  opened: Array<{ url: string; headers?: Record<string, string> }> = [];
  sockets: Array<RealtimeSocket & { open: () => void }> = [];

  buildSocketUrl = async (socketKey: string): Promise<string> =>
    buildRealtimeSocketUrl('https://rt.example.com', socketKey);

  buildSocketHeaders = async (): Promise<Record<string, string> | undefined> =>
    sessionCookieHeaders('jwt-abc');

  createSocket = (url: string, headers?: Record<string, string>): RealtimeSocket => {
    this.opened.push({ url, headers });
    const socket = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(): void {},
      close(): void {},
      open(): void {
        this.readyState = 1;
        this.onopen?.();
      },
    } as RealtimeSocket & { open: () => void };
    this.sockets.push(socket);
    return socket;
  };

  onForeground = (): (() => void) => () => {};
}

test('the core passes the session cookie header to createSocket', async () => {
  const platform = new RecordingPlatform();
  const client = new RealtimeClient(platform, { reconnectBaseMs: 5, reconnectMaxMs: 10 });

  client.init({ id: 'user-a', name: 'Alice', avatar: null });
  const release = client.on('chat:community-1', 'message', () => {});

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(platform.opened.length, 1);
  assert.equal(platform.opened[0].url, 'wss://rt.example.com/ws?room=chat%3Acommunity-1');
  assert.deepEqual(platform.opened[0].headers, { Cookie: `${SESSION_COOKIE_NAME}=jwt-abc` });
  assert.ok(!/[?&]token=/.test(platform.opened[0].url));

  release();
  client.destroy();
});
