import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarBackground, nameInitials } from "@/lib/avatar";
import type { ServiceClient } from "@/lib/supabase/service";
import type { ExpoPushDelivery, ExpoPushMessage } from "./expo";
import type { FcmDataMessage, FcmDeliveryReport } from "./fcm";
import {
  directMessageFcmData,
  directMessagePushMessages,
  directMessagePushPlan,
  sendDirectMessagePush,
  type DirectMessagePreferences,
} from "./direct-message";

const NOW = new Date("2026-10-23T20:00:00Z");

function preferences(overrides: Partial<DirectMessagePreferences> = {}): DirectMessagePreferences {
  return {
    chat_push_enabled: true,
    chat_sound: "default",
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
    quiet_hours_timezone: "UTC",
    ...overrides,
  };
}

test("no row means chat pushes are on and audible", () => {
  assert.deepEqual(directMessagePushPlan(undefined, NOW), { send: true, audible: true });
});

test("the chat master switch turns DM pushes off completely", () => {
  assert.deepEqual(
    directMessagePushPlan(preferences({ chat_push_enabled: false }), NOW),
    { send: false, audible: false },
  );
});

test("quiet hours and the silent choice keep the push but drop the buzz", () => {
  assert.deepEqual(
    directMessagePushPlan(
      preferences({
        quiet_hours_enabled: true,
        quiet_hours_start: "19:00",
        quiet_hours_end: "07:00",
      }),
      NOW,
    ),
    { send: true, audible: false },
  );
  assert.deepEqual(
    directMessagePushPlan(preferences({ chat_sound: "silent" }), NOW),
    { send: true, audible: false },
  );
});

test("a DM push wears the sender, the preview and a per-conversation collapse id", () => {
  const [message] = directMessagePushMessages(["ExpoPushToken[one]"], {
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    content: "Hi there",
    hasImage: false,
    isReply: false,
    audible: true,
  });

  assert.equal(message.title, "John");
  assert.equal(message.body, "Hi there");
  assert.equal(message.channelId, "messages");
  assert.equal(message.sound, "default");
  assert.equal(message.collapseId, "dm-dm-1");
  assert.deepEqual(message.data, {
    type: "dm_message",
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    silent: false,
  });
});

test("an image-only DM previews as a photo", () => {
  const [message] = directMessagePushMessages(["ExpoPushToken[one]"], {
    conversationId: "dm-1",
    messageId: "m-2",
    senderId: "u-2",
    senderName: null,
    senderAvatarUrl: null,
    content: "",
    hasImage: true,
    isReply: false,
    audible: false,
  });

  assert.equal(message.title, "New message");
  assert.equal(message.body, "Sent a photo");
  assert.equal(message.channelId, "messages-silent");
});

test("the direct-FCM DM payload carries the sender photo and conversation", () => {
  const data = directMessageFcmData({
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    content: "Hi there",
    hasImage: false,
    isReply: false,
    audible: true,
    timestamp: 1234,
  });

  assert.equal(data.type, "dm_message");
  assert.equal(data.direct, "1");
  assert.equal(data.conversationId, "dm-1");
  assert.equal(data.senderId, "u-2");
  assert.equal(data.title, "John");
  assert.equal(data.message, "Hi there");
  assert.equal(data.imageUrl, "https://media.example/john.webp");
  assert.equal(data.senderAvatarUrl, "https://media.example/john.webp");
  assert.equal(data.silent, "0");
  assert.equal(data.timestamp, "1234");
});

// ── Delivery shape (fake database, fake providers) ──────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeBuilder {
  select: (columns?: string, options?: unknown) => FakeBuilder;
  eq: () => FakeBuilder;
  in: (column: string, values: string[]) => FakeBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (
    onFulfilled: (value: { data: unknown; error: null }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  delete: () => FakeBuilder;
}

/**
 * A stand-in for the service-role client. Every builder is a thenable that
 * records when it was *started* and answers after `latencyMs`, so a test can
 * tell "issued together" from "issued one after another".
 */
function fakeDb(
  rows: Record<string, unknown>,
  started: string[],
  latencyMs = 35,
): ServiceClient {
  return {
    from(table: string) {
      let mode: "select" | "delete" = "select";
      const settle = () => {
        started.push(`${table}:${mode}`);
        return sleep(latencyMs).then(() => ({ data: rows[table] ?? [], error: null }));
      };
      const builder: FakeBuilder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () => settle(),
        then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
        delete: () => {
          mode = "delete";
          return builder;
        },
      };
      return builder;
    },
  } as unknown as ServiceClient;
}

function delivery(overrides: Partial<ExpoPushDelivery> = {}): ExpoPushDelivery {
  return {
    delivered: 0,
    permanentFailures: 0,
    transientFailures: 0,
    deadTokens: [],
    receiptRefs: [],
    requests: 1,
    settled: true,
    providerError: null,
    ...overrides,
  };
}

function fcmReport(overrides: Partial<FcmDeliveryReport> = {}): FcmDeliveryReport {
  return { outcomes: [], requestError: null, ...overrides };
}

const PARAMS = {
  recipientId: "u-1",
  conversationId: "dm-1",
  messageId: "m-1",
  senderId: "u-2",
  senderName: "John",
  senderAvatarUrl: null,
  content: "Hi there",
  hasImage: false,
  isReply: false,
};

const NOW_CLOCK = () => new Date("2026-10-24T12:00:00Z");

const PREFERENCES = {
  chat_push_enabled: true,
  chat_sound: "default",
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_timezone: "UTC",
};

test("a DM push reads tokens, preferences and FCM tokens in one round trip", async () => {
  const started: string[] = [];
  const db = fakeDb(
    {
      push_tokens: [{ token: "ExpoPushToken[a]", platform: "android" }],
      notification_preferences: PREFERENCES,
      fcm_tokens: [{ token: "fcm-1" }],
    },
    started,
    40,
  );

  const began = Date.now();
  await sendDirectMessagePush(PARAMS, {
    db,
    fcmConfigured: true,
    now: NOW_CLOCK,
    sendExpo: async (messages) => delivery({ delivered: messages.length }),
    sendFcm: async () =>
      fcmReport({ outcomes: [{ token: "fcm-1", ok: true, deadToken: false, error: null }] }),
  });
  const elapsed = Date.now() - began;

  assert.deepEqual(started.sort(), ["fcm_tokens:select", "notification_preferences:select", "push_tokens:select"]);
  // Serialized reads would take 3 × 40 ms; overlapping them takes about one.
  assert.ok(elapsed < 80, `reads were serialized (${elapsed} ms)`);
});

test("Expo and direct FCM are both in flight before either answers", async () => {
  const events: string[] = [];
  const reads: string[] = [];
  const db = fakeDb(
    {
      push_tokens: [
        { token: "ExpoPushToken[ios]", platform: "ios" },
        { token: "ExpoPushToken[android]", platform: "android" },
      ],
      notification_preferences: PREFERENCES,
      fcm_tokens: [{ token: "fcm-1" }],
    },
    reads,
    1,
  );

  await sendDirectMessagePush(PARAMS, {
    db,
    fcmConfigured: true,
    now: NOW_CLOCK,
    sendExpo: async () => {
      events.push("expo:start");
      await sleep(40);
      events.push("expo:end");
      return delivery({ delivered: 1 });
    },
    sendFcm: async () => {
      events.push("fcm:start");
      await sleep(40);
      events.push("fcm:end");
      return fcmReport({ outcomes: [{ token: "fcm-1", ok: true, deadToken: false, error: null }] });
    },
  });

  const firstEnd = events.findIndex((event) => event.endsWith(":end"));
  // Both transports must have been asked before the first one answered; a
  // serialized implementation would start the second only after the first end.
  assert.ok(events.indexOf("expo:start") < firstEnd, `Expo waited: ${events.join(",")}`);
  assert.ok(events.indexOf("fcm:start") < firstEnd, `FCM waited: ${events.join(",")}`);
});

test("a provider-wide FCM failure falls back to the held-back Android Expo token", async () => {
  const sent: string[] = [];
  const db = fakeDb(
    {
      push_tokens: [{ token: "ExpoPushToken[android]", platform: "android" }],
      notification_preferences: PREFERENCES,
      fcm_tokens: [{ token: "fcm-1" }],
    },
    [],
    1,
  );

  await sendDirectMessagePush(PARAMS, {
    db,
    fcmConfigured: true,
    now: NOW_CLOCK,
    sendExpo: async (messages: ExpoPushMessage[]) => {
      sent.push(...messages.map((message) => message.to));
      return delivery({ delivered: messages.length });
    },
    sendFcm: async (messages: FcmDataMessage[]) =>
      fcmReport({
        requestError: "FCM OAuth 503",
        outcomes: messages.map((message) => ({
          token: message.token,
          ok: false,
          deadToken: false,
          error: "auth_failed",
        })),
      }),
  });

  assert.deepEqual(sent, ["ExpoPushToken[android]"]);
});

test("a successful FCM send does not also turn the Android Expo token into a notification", async () => {
  const sent: string[] = [];
  const db = fakeDb(
    {
      push_tokens: [{ token: "ExpoPushToken[android]", platform: "android" }],
      notification_preferences: PREFERENCES,
      fcm_tokens: [{ token: "fcm-1" }],
    },
    [],
    1,
  );

  await sendDirectMessagePush(PARAMS, {
    db,
    fcmConfigured: true,
    now: NOW_CLOCK,
    sendExpo: async (messages: ExpoPushMessage[]) => {
      sent.push(...messages.map((message) => message.to));
      return delivery({ delivered: messages.length });
    },
    sendFcm: async () =>
      fcmReport({ outcomes: [{ token: "fcm-1", ok: true, deadToken: false, error: null }] }),
  });

  assert.deepEqual(sent, []);
});

test("a DM without a photo uses the app's exact initials and palette color", () => {
  const data = directMessageFcmData({
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "sundar pichai",
    senderAvatarUrl: null,
    content: "hi man",
    hasImage: false,
    isReply: false,
    audible: true,
    timestamp: 1234,
  });

  assert.equal(data.avatarInitials, "SP");
  assert.equal(data.avatarColor, avatarBackground("sundar pichai"));
  assert.equal(data.avatarInitials, nameInitials("sundar pichai"));
  assert.equal(data.senderAvatarInitials, "SP");
  assert.equal(data.senderAvatarColor, avatarBackground("sundar pichai"));
  assert.equal(data.senderAvatarUrl, undefined);
});
