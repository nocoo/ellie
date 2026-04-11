-- Add avatar_path for GUID-based avatar storage
-- When non-empty, this is the R2 path to the user's uploaded avatar
-- When empty, fallback to legacy UID-based path computation
-- has_avatar is kept for backward compatibility but avatar_path is the source of truth

ALTER TABLE users ADD COLUMN avatar_path TEXT NOT NULL DEFAULT '';
