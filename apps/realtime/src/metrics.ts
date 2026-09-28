/**
 * Lightweight, aggregate-only observability counters for the realtime service.
 *
 * Deliberately plain numbers (no timers, no per-event logs): a Durable Object's
 * hot path is measured, not narrated. The counters are exposed through the DO's
 * secret-protected `stats` action and are safe to scrape — they contain counts
 * only, never message contents, tokens or user identifiers.
 *
 * `apps/realtime/src/index.ts` uses them to emit ONE aggregated warning per
 * publish when deliveries actually fail, instead of a log line per event.
 */

export class RealtimeMetrics {
  /** Accepted WebSocket upgrades. */
  connectionsOpened = 0;
  /** Sockets removed from the room (close, error, or send-failure eviction). */
  connectionsClosed = 0;
  /** Evictions triggered by a failed `ws.send()`. */
  sendFailures = 0;
  /** Server-side publishes handled by this DO. */
  eventsPublished = 0;
  /** Sum of recipients addressed across all publishes (fan-out cost). */
  fanoutRecipients = 0;
  /**
   * `ws.send()` calls attempted for EVENT fan-out — exactly one per recipient
   * of a published topic. Presence traffic is deliberately NOT mixed in here:
   * a presence broadcast addresses every socket in the room, so counting it as
   * `deliverAttempts` made the send count for one publish unreadable (a 500
   * socket room re-broadcasting presence inflates it by 500 per flush). Keeping
   * them apart is what makes `deliverAttempts` usable as "cost of this publish".
   */
  deliverAttempts = 0;
  /**
   * Bytes written by EVENT fan-out (payload length × successful recipients).
   * Exposed so a change to presence, publish or the fan-out indexes can be shown
   * not to have altered the cost of a message broadcast.
   */
  eventPayloadBytes = 0;
  /** Presence flush windows that wrote at least one frame. */
  presenceBroadcasts = 0;
  /**
   * Flush windows that covered only part of the room because the per-window send
   * budget ran out. Zero for any room small enough to be refreshed in one window;
   * nonzero means the room is rotating through the attached sockets.
   */
  presenceDeferredWindows = 0;
  /** `ws.send()` calls attempted for presence broadcasts (one per socket per flush). */
  presenceDeliverAttempts = 0;
  /**
   * Bytes written by presence broadcasts (payload length × successful
   * recipients). The payload is a count, so this stays ~60 B per socket per
   * flush instead of ~one roster entry per member per socket.
   */
  presencePayloadBytes = 0;
  /** Presence flushes that changed the online count and were broadcast. */
  presenceCountChanges = 0;
  /** Presence flushes skipped because the online count had not changed. */
  presenceSkipped = 0;
  /** Presence flushes collapsed into a scheduled one (reconnect storms). */
  presenceCoalesced = 0;
  /**
   * Member-authored publishes (WebSocket `publish` frames) that passed the
   * security boundary and were fanned out. Kept apart from `eventsPublished`,
   * which counts secret-authenticated server publishes, so an operator can see
   * how much of a room's traffic is client-originated at all.
   */
  clientPublishesAccepted = 0;
  /** Client publishes dropped because the topic is not client-publishable. */
  clientPublishRejectedTopic = 0;
  /** Client publishes dropped because the payload was malformed/oversized. */
  clientPublishRejectedPayload = 0;
  /** Client publishes dropped by the per-socket/per-user token bucket. */
  clientPublishRateLimited = 0;
  /**
   * Server publishes dropped as a replay of an `event_id` already delivered
   * (fan-out retry that raced a successful first attempt). Nonzero means the
   * retry path engaged but the room was not told twice.
   */
  duplicateDeliveriesSuppressed = 0;
  /** Membership authorization calls that reached the internal API. */
  membershipChecks = 0;
  /** Membership checks that could not complete and were denied (fail-closed). */
  membershipChecksFailed = 0;
  membershipCacheHits = 0;
  membershipCacheEvictions = 0;

  toJSON(): Record<string, number> {
    return {
      connectionsOpened: this.connectionsOpened,
      connectionsClosed: this.connectionsClosed,
      sendFailures: this.sendFailures,
      eventsPublished: this.eventsPublished,
      fanoutRecipients: this.fanoutRecipients,
      deliverAttempts: this.deliverAttempts,
      eventPayloadBytes: this.eventPayloadBytes,
      presenceBroadcasts: this.presenceBroadcasts,
      presenceDeferredWindows: this.presenceDeferredWindows,
      presenceDeliverAttempts: this.presenceDeliverAttempts,
      presencePayloadBytes: this.presencePayloadBytes,
      presenceCountChanges: this.presenceCountChanges,
      presenceSkipped: this.presenceSkipped,
      presenceCoalesced: this.presenceCoalesced,
      clientPublishesAccepted: this.clientPublishesAccepted,
      clientPublishRejectedTopic: this.clientPublishRejectedTopic,
      clientPublishRejectedPayload: this.clientPublishRejectedPayload,
      clientPublishRateLimited: this.clientPublishRateLimited,
      duplicateDeliveriesSuppressed: this.duplicateDeliveriesSuppressed,
      membershipChecks: this.membershipChecks,
      membershipChecksFailed: this.membershipChecksFailed,
      membershipCacheHits: this.membershipCacheHits,
      membershipCacheEvictions: this.membershipCacheEvictions,
    };
  }
}
