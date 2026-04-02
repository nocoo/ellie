-- Add moderator_ids column to forums table (comma-separated user IDs)
-- moderators column (usernames) is kept for backward compatibility but deprecated
ALTER TABLE forums ADD COLUMN moderator_ids TEXT NOT NULL DEFAULT '';
