-- Phase 4c of docs/17-email-verification.md
--
-- Enforces uniqueness on `users.email_normalized` at the database layer.
-- Partial index: rows with `email_normalized = ''` (legacy / cleared
-- duplicates) are intentionally left un-constrained — they have not yet
-- claimed an email and must be free to do so via the verify flow.
--
-- This index MUST land BEFORE the verify endpoint (rev3 §7.3, Phase 3b) can
-- safely write users.email; otherwise two concurrent verify requests for the
-- same address can both pass an application-layer "is this email free?"
-- check. The unique index is the real safety net; the app-layer conditional
-- UPDATE keeps the error surface clean by translating constraint violations
-- into 409 EMAIL_ALREADY_IN_USE.
--
-- Pre-flight gate (Phase 4b, see scripts/find-duplicate-emails.ts):
--   the analyzer MUST report zero duplicate groups against the target DB
--   before this migration is applied; otherwise CREATE UNIQUE INDEX will
--   fail and the migration will roll back. Phase 4b ops gate against the
--   production tongjinet-db snapshot completed 2026-05-02 with exit=0.
--
-- Rollback: DROP INDEX users_email_normalized_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uniq
ON users(email_normalized)
WHERE email_normalized != '';
