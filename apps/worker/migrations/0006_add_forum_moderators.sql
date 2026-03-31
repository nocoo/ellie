-- Add moderators column to forums table (tab-separated usernames from Discuz)
ALTER TABLE forums ADD COLUMN moderators TEXT NOT NULL DEFAULT '';
