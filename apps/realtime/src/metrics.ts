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
   * a roster re-broadcast addresses every socket in the room, so counting it as
   * `deliverAttempts` made the send count for one publish unreadable (a 500
   * socket room re-broadcasting presence inflates it by 500 per flush). Keeping
   * them apart is what makes `deliverAttempts` usable as "cost of this publish".
   */
  deliverAttempts = 0;
  /** Presence snapshots actually written to sockets. */
  presenceBroadcasts = 0;
  /** `ws.send()` calls attempted for presence snapshots (one per socket per flush). */
  presenceDeliverAttempts = 0;
  /** Presence flushes skipped because the snapshot had not changed. */
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
  /** Membership authorization calls that reached the internal API. */
  membershipChecks = 0;
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
      presenceBroadcasts: this.presenceBroadcasts,
      presenceDeliverAttempts: this.presenceDeliverAttempts,
      presenceSkipped: this.presenceSkipped,
      presenceCoalesced: this.presenceCoalesced,
      clientPublishesAccepted: this.clientPublishesAccepted,
      clientPublishRejectedTopic: this.clientPublishRejectedTopic,
      clientPublishRejectedPayload: this.clientPublishRejectedPayload,
      clientPublishRateLimited: this.clientPublishRateLimited,
      membershipChecks: this.membershipChecks,
      membershipCacheHits: this.membershipCacheHits,
      membershipCacheEvictions: this.membershipCacheEvictions,
    };
  }
}
