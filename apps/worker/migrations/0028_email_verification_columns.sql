-- Phase 1 of docs/17-email-verification.md
-- Adds the three columns required to track email verification state.
-- Pure schema addition; no behavior change in this migration.
--
-- Sentinels (see docs/17 §3, §6.1):
--   email_verified_at = 0  → unverified
--   email_verified_at > 0  → unix seconds at verification
--   email_normalized       → lower(trim(email)); maintained by app layer.
--                            Uniqueness is enforced in a follow-up migration
--                            (0029) AFTER ops resolves duplicates and BEFORE
--                            the email-change endpoint is exposed.
--   email_changed_at       → unix seconds of the last successful email change
--                            while unverified; drives the 24h change quota.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_normalized  TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email_changed_at  INTEGER NOT NULL DEFAULT 0;
