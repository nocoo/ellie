-- Add has_avatar flag for posting permission check
-- The existing avatar TEXT field is legacy (always empty string)
-- has_avatar is the source of truth: 1 = user has uploaded avatar, 0 = no avatar

ALTER TABLE users ADD COLUMN has_avatar INTEGER NOT NULL DEFAULT 0;
