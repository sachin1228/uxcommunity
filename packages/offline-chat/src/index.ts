/**
 * Offline-first chat domain — the contract both the web IndexedDB store and
 * the Expo SQLite store implement.
 *
 * WHY A PACKAGE
 *   Community chat and DMs already share almost every rule: the same compound
 *   (created_at, id) cursor, the same "a row we hold wins" merge, the same
 *   optimistic-then-authoritative send, and the same bounded window. Web and
 *   mobile each grew their own copy of the read path; offline support adds a
 *   durable outbox and checkpoint semantics on top, and duplicating THOSE
 *   would be where the two platforms start disagreeing about what "sent"
 *   means.
 *
 * WHAT LIVES HERE
 *   * pure message/cursor merge rules (no storage, no React, no platform API);
 *   * the outbox state machine + retry/backoff policy;
 *   * a storage adapter interface with an in-memory reference implementation;
 *   * a sync controller that sequences hydrate → drain → catch-up and only
 *     advances a checkpoint after the corresponding rows are committed.
 *
 * WHAT DOES NOT
 *   * IndexedDB / expo-sqlite adapters (they live in their apps);
 *   * React state (the apps subscribe to the controller's events);
 *   * any network client (the apps inject a `SyncTransport`).
 */

export * from "./types";
export * from "./ids";
export * from "./messages";
export * from "./outbox";
export * from "./backoff";
export * from "./storage";
export * from "./sync";
export * from "./memory-storage";
