-- Add last_thread_subject to forums table for displaying latest thread title
ALTER TABLE forums ADD COLUMN last_thread_subject TEXT NOT NULL DEFAULT '';

-- Backfill from threads table using existing last_thread_id
UPDATE forums SET last_thread_subject = COALESCE(
  (SELECT subject FROM threads WHERE threads.id = forums.last_thread_id),
  ''
) WHERE last_thread_id > 0;
