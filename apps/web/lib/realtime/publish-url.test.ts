import assert from "node:assert/strict";
import test from "node:test";

/**
 * Regression test for production-readiness audit M-7 (JWT in query parameters).
 *
 * The web realtime client must never put the session JWT in the WebSocket URL:
 * a 7-day credential in a query string is captured by proxies, access logs and
 * browser history. Browsers send the `uxcommunity_session` cookie on the
 * handshake automatically, which is what the realtime Worker authenticates.
 *
 * The client is imported dynamically AFTER a fake WebSocket is installed, so
 * the URLs it builds can be captured.
 */
test("the web realtime client builds token-free WebSocket URLs (audit M-7)", async () => {
  const urls: string[] = [];
  const globalWithWs = globalThis as { WebSocket?: unknown };
  const previousWebSocket = globalWithWs.WebSocket;

  class FakeSocket {
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    constructor(url: string) {
      urls.push(url);
    }
    send(): void {}
    close(): void {}
  }
  globalWithWs.WebSocket = FakeSocket;

  try {
    const { realtimeClient } = await import("./client");
    const ClientClass = (realtimeClient as unknown as { constructor: new () => typeof realtimeClient })
      .constructor;
    const client = new ClientClass();

    // The API that used to inject the session JWT into the URL is gone.
    assert.equal(
      (client as unknown as { setSessionToken?: unknown }).setSessionToken,
      undefined,
      "RealtimeClient must not expose a way to set a URL token",
    );

    client.init({ id: "user-a", name: "Alice", avatar: null });
    const release = client.on("chat:community-a", "message", () => {});
    client.connect();

    assert.ok(urls.length >= 1, "a socket URL must have been built");
    for (const url of urls) {
      assert.ok(!/[?&]token=/.test(url), `URL must not carry a token: ${url}`);
    }
    assert.ok(
      urls.some((url) => url.includes("room=chat%3Acommunity-a")),
      "the room is still addressed in the URL",
    );

    release();
    client.destroy();
  } finally {
    globalWithWs.WebSocket = previousWebSocket;
  }
});
