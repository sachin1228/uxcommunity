"use client";

/**
 * The web app's one offline chat engine.
 *
 * Activation is deliberately failure-tolerant: a browser with IndexedDB
 * blocked (private mode, storage disabled, a corrupt database) returns null and
 * every caller falls back to the existing online path. Offline support is an
 * enhancement; it must never be the reason a chat does not load.
 */

import {
  createOfflineChatController,
  type ChatKind,
  type ChatRef,
  type OfflineChatController,
} from "@uxcommunity/offline-chat";
import { createIndexedDbStorage, isIndexedDbAvailable } from "./indexed-db";
import { createWebTransport } from "./transport";

type Payload = Record<string, unknown>;

let controller: OfflineChatController<Payload> | null = null;
let activeUserId: string | null = null;
const activationListeners = new Set<
  (engine: OfflineChatController<Payload> | null) => void
>();

/**
 * Subscribe to engine activation/deactivation. Hooks mount before the dashboard
 * provider's effect (React runs child effects first), so they cannot assume an
 * engine exists at mount; this lets them hydrate when it becomes available.
 */
export function onOfflineChatChange(
  listener: (engine: OfflineChatController<Payload> | null) => void,
): () => void {
  activationListeners.add(listener);
  listener(controller);
  return () => activationListeners.delete(listener);
}

function notifyActivation(): void {
  for (const listener of [...activationListeners]) {
    try {
      listener(controller);
    } catch {
      // A subscriber must not break activation.
    }
  }
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

export async function activateOfflineChat(
  userId: string,
): Promise<OfflineChatController<Payload> | null> {
  if (typeof window === "undefined") return null;
  if (activeUserId === userId && controller) return controller;

  deactivateOfflineChat();
  if (!isIndexedDbAvailable()) return null;

  const next = createOfflineChatController<Payload>({
    storage: createIndexedDbStorage(),
    transport: createWebTransport(),
    autoDrain: true,
  });

  try {
    await next.activate(userId);
  } catch {
    // IndexedDB unavailable / blocked / incompatible: run online-only.
    next.deactivate();
    return null;
  }

  controller = next;
  activeUserId = userId;
  next.setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  notifyActivation();
  return next;
}

export function deactivateOfflineChat(): void {
  controller?.deactivate();
  controller = null;
  activeUserId = null;
  notifyActivation();
}

/** Event the provider dispatches when connectivity returns. */
export const OFFLINE_RESUME_EVENT = "ux-offline-resume";

export function notifyOfflineResume(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_RESUME_EVENT));
  }
}
