-- Migration: Add visibility field to forums table
-- Purpose: Control forum access by user role
-- Values: 'public' (all), 'members' (logged in), 'staff' (mods+), 'admin' (admin only)

ALTER TABLE forums ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK(visibility IN ('public', 'members', 'staff', 'admin'));

-- Create index for filtering by visibility
CREATE INDEX IF NOT EXISTS idx_forums_visibility ON forums(visibility);
