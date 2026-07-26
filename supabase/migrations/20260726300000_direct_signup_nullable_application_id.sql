-- Migration: allow users to be created without an invitation application
--
-- Previously application_id was NOT NULL, tying every user account to an
-- approved application + invitation token. This migration makes it nullable
-- so the direct-signup flow (bypassing the apply form) can create accounts
-- without a linked application.
--
-- The unique constraint added earlier still applies to non-null values, so
-- each approved application can still only produce one user account.

alter table users
  alter column application_id drop not null;
