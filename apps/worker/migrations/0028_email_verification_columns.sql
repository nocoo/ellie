-- Phase 1 of docs/17-email-verification.md
-- Adds the three columns required to track email verification state.
-- Pure schema addition; no behavior change in this migration.
--
-- Sentinels (see docs/17 §3, §6.1):
--   email_verified_at = 0  → unverified
--   email_verified_at > 0  → unix seconds at verification
--   email_normalized       → lower(trim(email)); maintained by app layer.
--                            Uniqueness is enforced in a follow-up migration
--                            (0029) so the verify endpoint (rev3 §7.3) has a
--                            DB-level safety net before it writes users.email.
--                            Phase 5a ops clears legacy email fields (no
--                            duplicate resolution needed under rev3 — every
--                            row gets reset to '' / 0).
--   email_changed_at       → reserved for a future verified-user email-change
--                            RFC. NOT written by the rev3 first-add flow and
--                            does NOT currently drive any quota.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_normalized  TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email_changed_at  INTEGER NOT NULL DEFAULT 0;
