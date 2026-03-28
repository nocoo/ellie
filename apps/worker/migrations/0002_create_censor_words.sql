-- Create censor_words table for content filtering
CREATE TABLE IF NOT EXISTS censor_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  find TEXT NOT NULL,
  replacement TEXT NOT NULL DEFAULT '**',
  action TEXT NOT NULL DEFAULT 'replace' CHECK(action IN ('ban', 'replace')),
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_censor_words_find ON censor_words(find);
