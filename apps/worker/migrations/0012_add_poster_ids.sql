-- Migration: Add last_poster_id columns to forums and threads
-- Part of user cache refactoring (docs/09-user-cache-refactor.md)

-- Step 1: Add last_poster_id to forums
ALTER TABLE forums ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;

-- Step 2: Add last_poster_id to threads
ALTER TABLE threads ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;

-- Step 3: Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_forums_last_poster_id ON forums(last_poster_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_poster_id ON threads(last_poster_id);

-- Note: Data will be populated via recalcForums/recalcThreads after deployment
