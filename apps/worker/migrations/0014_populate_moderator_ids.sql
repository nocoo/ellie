-- Populate moderator_ids from moderators column (usernames -> user IDs)
-- This is a data migration to enable clickable moderator names

-- Create a temporary table to store username -> id mapping for moderators
-- Note: moderators column contains tab-separated usernames from Discuz

-- Step 1: For each forum with moderators, look up user IDs by username
-- SQLite doesn't have array functions, so we handle single moderator case
-- and common multi-moderator cases

-- Single moderator forums (no tabs/commas)
UPDATE forums
SET moderator_ids = (
  SELECT CAST(u.id AS TEXT)
  FROM users u
  WHERE u.username = forums.moderators
)
WHERE moderators != ''
  AND moderators NOT LIKE '%	%'  -- no tabs
  AND moderators NOT LIKE '%,%'   -- no commas
  AND EXISTS (SELECT 1 FROM users u WHERE u.username = forums.moderators);

-- For forums with multiple moderators (tab-separated or comma-separated),
-- this migration cannot handle them automatically in pure SQL.
-- They need to be handled by a separate script or manually.
-- The moderators column format varies (tabs from Discuz, or commas).
