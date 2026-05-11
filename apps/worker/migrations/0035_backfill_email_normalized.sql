-- Backfill email_normalized for existing users who have a raw email but no
-- normalized form yet.  Registration now writes email_normalized at INSERT
-- time, so only pre-existing rows need this one-shot fix.
--
-- The UPDATE uses a subquery to skip rows whose normalized email would
-- collide with an already-populated row (the 0029 partial unique index).
-- Collisions are left with email_normalized = '' so the admin can resolve
-- them manually.  This makes the migration idempotent and safe to re-run.
UPDATE users
SET email_normalized = LOWER(TRIM(email))
WHERE email != ''
  AND email_normalized = ''
  AND LOWER(TRIM(email)) NOT IN (
    SELECT email_normalized FROM users WHERE email_normalized != ''
  );
