-- Migration: enforce one user account per invitation application
--
-- Without this constraint two concurrent requests with the same invite token
-- could both pass the application_id read-check in /api/signup/complete and
-- each insert a distinct user row, breaking the single-account-per-invite
-- guarantee. The unique index makes duplicate creation impossible at the DB
-- level and turns any race into a detectable unique-violation error (code 23505).
--
-- Safe to run on a live DB:
--   • If duplicate application_id rows already exist the statement will fail
--     with "could not create unique index". Resolve duplicates first (keep the
--     most recent row, delete the rest) before applying this migration.

alter table users
  add constraint users_application_id_unique unique (application_id);
