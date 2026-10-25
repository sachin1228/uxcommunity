/**
 * The mobile app's one offline chat engine.
 *
 * Activation follows the auth identity (`AuthContext.applyUser`): one SQLite
 * database and one controller per member. Logout stops the worker and aborts
 * in-flight sends but deliberately KEEPS the account's queue on disk — the
 * message has not reached the server yet, and silently deleting it would break
 * the outbox guarantee. The rows are unreachable while another account is
 * active because they live in a different database file.
 *
 * Connectivity is best effort: React Native has no reliable cross-platform
 * online event without another dependency, so the engine treats an accepted
 * request, a realtime reconnect, a foreground transition and an explicit retry
 * as the signals to drain. A failed request backs off; it is never dropped.
 */

import { AppState, type AppStateStatus } from "react-native";
import {
  createOfflineChatController,
  type ChatKind,
  type ChatRef,
  type OfflineChatController,
} from "../../../packages/offline-chat/src";
import { createMobileTransport } from "./transport";
import { createSqliteStorage, offlineDatabaseName } from "./storage";
import { openExpoSqlDriver } from "./sql-driver";

type Payload = Record<string, unknown>;

let controller: OfflineChatController<Payload> | null = null;
let activeUserId: string | null = null;
let activation: Promise<OfflineChatController<Payload> | null> | null = null;

const changeListeners = new Set<
  (engine: OfflineChatController<Payload> | null) => void
>();
const resumeListeners = new Set<() => void>();

function notifyChange(): void {
  for (const listener of [...changeListeners]) {
    try {
      listener(controller);
    } catch {
      // A subscriber must not break activation.
    }
  }
}

export function onOfflineChatChange(
  listener: (engine: OfflineChatController<Payload> | null) => void,
): () => void {
  changeListeners.add(listener);
  listener(controller);
  return () => changeListeners.delete(listener);
}

/** Fired on foreground transitions; open screens revalidate their window. */
export function onOfflineResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

function notifyResume(): void {
  for (const listener of [...resumeListeners]) {
    try {
      listener();
    } catch {
      // Best effort.
    }
  }
}

let appStateSubscription: { remove: () => void } | null = null;
function ensureAppStateSubscription(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener(
    "change",
    (state: AppStateStatus) => {
      if (state !== "active") return;
      // A foregrounded app is the strongest "try again now" signal available.
      // The API may still be unreachable; failures re-arm the backoff.
      controller?.setOnline(true);
      void controller?.drainOutbox().catch(() => undefined);
      notifyResume();
    },
  );
}

export function offlineRef(kind: ChatKind, id: string): ChatRef {
  return { kind, id };
}

export function getOfflineChat(): OfflineChatController<Payload> | null {
  return controller;
}

export function getOfflineUserId(): string | null {
  return activeUserId;
}

export function deactivateOfflineChat(): void {
  controller?.deactivate();
  controller = null;
  activeUserId = null;
  activation = null;
  notifyChange();
}

/**
 * Activate for `userId`, or suspend when null. Idempotent; concurrent calls
 * share one activation promise.
 */
export function activateOfflineChat(
  userId: string | null,
): Promise<OfflineChatController<Payload> | null> {
  if (!userId) {
    deactivateOfflineChat();
    return Promise.resolve(null);
  }
  if (activeUserId === userId && controller) return Promise.resolve(controller);
  if (activation && activeUserId === userId) return activation;

  deactivateOfflineChat();
  activeUserId = userId;

  const run = (async () => {
    try {
      const driver = await openExpoSqlDriver(offlineDatabaseName(userId));
      const next = createOfflineChatController<Payload>({
        storage: createSqliteStorage(driver),
        transport: createMobileTransport(),
        autoDrain: true,
      });
      await next.activate(userId);
      if (activeUserId !== userId) {
        next.deactivate();
        return null;
      }
      controller = next;
      ensureAppStateSubscription();
      next.setOnline(true);
      notifyChange();
      void next.drainOutbox().catch(() => undefined);
      return next;
    } catch {
      // SQLite unavailable / schema incompatible: run online-only. The online
      // chat path never depends on this module.
      if (activeUserId === userId) {
        controller = null;
        notifyChange();
      }
      return null;
    }
  })();

  activation = run;
  void run.finally(() => {
    if (activation === run) activation = null;
  });
  return run;
}

/** Reconnect signal from the realtime client / any successful API call. */
export function notifyOfflineOnline(): void {
  controller?.setOnline(true);
  void controller?.drainOutbox().catch(() => undefined);
}

/** Explicit "clear this device" action (account deletion, support request). */
export async function clearOfflineAccount(userId: string): Promise<void> {
  try {
    const driver = await openExpoSqlDriver(offlineDatabaseName(userId));
    await driver.deleteDatabase();
  } catch {
    // Nothing to clear / native module unavailable.
  }
}
