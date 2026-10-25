-- ============================================================
-- Community chat: sender-scoped idempotency keys
--
-- WHY
--   Offline-first clients keep an outgoing queue and retry a send when the
--   network dropped before the response arrived. A retry is only safe when the
--   server can recognise the ORIGINAL write: two identical messages ("ok",
--   "ok") are legitimate, so text matching is not a key.
--
--   The DM send path already solved this (20261012120000_dm_hardening.sql):
--   `client_nonce` is a per-logical-send UUID from the client, with a unique
--   (user_id, client_nonce) index. A retried request collides on that index and
--   the API answers with the row the first attempt committed instead of
--   inserting a second one.
--
--   This migration gives community messages the same contract.
--
-- SHAPE
--   * `client_nonce` is nullable: older clients (and any server-side writer)
--     keep inserting rows without a key.
--   * The unique index is partial (`where client_nonce is not null`) because
--     Postgres already treats NULLs as distinct in a plain unique index; the
--     predicate makes the intent explicit and keeps the index small.
--   * The key is scoped per SENDER. Two members may legitimately generate the
--     same UUID (collision, copied payload) and must not block each other.
--
-- DEPLOYMENT ORDER
--   Apply this migration BEFORE deploying the API build that writes
--   `client_nonce`. The column is additive and the API tolerates its absence,
--   so applying it while the previous build is live is safe. Until it lands,
--   the API falls back to a non-idempotent insert — it never fails a send.
-- ============================================================

alter table public.community_messages
  add column if not exists client_nonce uuid;

create unique index if not exists idx_community_messages_sender_nonce
  on public.community_messages (user_id, client_nonce)
  where client_nonce is not null;

comment on column public.community_messages.client_nonce is
  'Client-generated idempotency key for one logical send (UUID). Retries reuse it; the unique (user_id, client_nonce) index makes a replay return the original row.';
