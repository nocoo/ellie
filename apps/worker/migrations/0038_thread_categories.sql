-- 0038_thread_categories.sql — Restore Discuz 主题分类 (thread categories)
--
-- ⚠️  PARTIALLY SUPERSEDED BY 0039_thread_categories_synthetic_id.sql.
--    0038 originally treated `forum_thread_types.id` as the imported
--    Discuz `typeid`. A dry-run on 2026-05-14 proved Discuz typeids are
--    forum-LOCAL (typeid=1 reused across fid=111+113, etc.). 0039 adds
--    `source_typeid` and forces `id` to be a synthetic global id minted
--    by `migrateForumThreadTypes`. The replay sequence stays
--    0000→...→0038→0039 (do NOT skip 0038 even on empty boxes — the
--    migrate ledger must remain sequential or `_migrations` will drift
--    from the live schema).
--
-- The remainder of this header documents the original 0038 design;
-- treat any "PK reuses Discuz typeid" wording below as superseded by
-- 0039.
--
-- Discuz lets each forum (fid) optionally publish a list of named
-- categories ("主题分类"). When enabled on a forum:
--   • the listing page shows a category filter,
--   • posting a new thread requires picking a category,
--   • the category name renders as a thread-title prefix.
--
-- The legacy implementation spreads this across three MySQL tables:
--   • pre_forum_thread.typeid          → per-thread category pick
--   • pre_forum_threadtype             → globally registered types
--                                        (only fid=0 in the dump — useless
--                                        for the per-forum picker)
--   • pre_forum_forumfield.threadtypes → PHP-serialized blob holding
--                                        the *real* per-forum picker
--                                        config (types, listable, required,
--                                        prefix flags)
--   • pre_forum_threadclass            → enabled/disabled per-forum
--                                        category rows (incl. tombstones
--                                        for clearable history)
--
-- We collapse the four into two D1 tables:
--   • forums: 4 INT columns mirroring the 4 forumfield flags so the
--     thread-list / new-thread paths can answer "does this forum use
--     categories?" without a join.
--   • forum_thread_types: one row per category. Primary key reuses the
--     Discuz `typeid` directly so old per-thread `typeid` references
--     stay stable across the migration; new admin-created rows get
--     `max(id)+1` from SQLite's implicit rowid allocator (no
--     AUTOINCREMENT — reviewer constraint, keeps the rowid space
--     contiguous with imported ids).
--
-- threads.type_id is plain INTEGER, NOT a FOREIGN KEY: cleared categories
-- (`enabled=0`) must keep their typeName legible via this table without
-- forcing an integrity check on every thread write, and a deleted-by-mistake
-- category should not orphan thousands of threads (reviewer constraint).
-- threads.type_name stays in the table as a denormalized cache for the
-- list/render path — see scripts/import/transforms/threads.ts.
--
-- Drift guard: tests/unit/migration-0038-schema.test.ts pins this exact
-- statement set across the live-migration path AND the fresh-DB bootstrap
-- paths (0000_init_schema.sql + 3 schema mirrors).

-- ─── threads.type_id ─────────────────────────────────────────────────
-- The per-thread foreign key into forum_thread_types.id (= Discuz typeid).
-- 0 = "no category" (forum has categories disabled, or category cleared).
ALTER TABLE threads ADD COLUMN type_id INTEGER NOT NULL DEFAULT 0;

-- ─── forums: 4 boolean-as-INT flags ──────────────────────────────────
-- Mirror Discuz pre_forum_forumfield columns:
--   threadtypes.required → required (forum must pick a category)
--   threadtypes.listable → listable (filter pill on list page)
--   threadtypes.prefix   → prefix   (render type name as title prefix)
-- enabled is the master switch — true iff this forum has *any* categories
-- configured (i.e. forumfield.threadtypes['types'] non-empty).
ALTER TABLE forums ADD COLUMN thread_types_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forums ADD COLUMN thread_types_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forums ADD COLUMN thread_types_listable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forums ADD COLUMN thread_types_prefix   INTEGER NOT NULL DEFAULT 0;

-- ─── forum_thread_types ──────────────────────────────────────────────
-- One row per category. PK reuses Discuz typeid so per-thread typeid
-- references survive the migration unchanged; admin-created rows
-- continue from max(id)+1 via SQLite's implicit rowid (no AUTOINCREMENT).
--
-- enabled=0 rows are tombstones: the category was once active and is
-- referenced by historical threads, so it stays in the table for
-- typeName resolution, but the admin/post UIs must hide it.
--
-- moderator_only mirrors pre_forum_threadclass.moderators — when set,
-- only forum moderators may post threads under this category. Not
-- enforced at this layer; consumed by the Worker validation path.
CREATE TABLE IF NOT EXISTS forum_thread_types (
  id              INTEGER PRIMARY KEY,         -- = Discuz typeid (imported as-is)
  forum_id        INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  icon            TEXT    NOT NULL DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 1,  -- 0 = tombstone (legacy threads only)
  moderator_only  INTEGER NOT NULL DEFAULT 0   -- 1 = restricted to mods (pre_forum_threadclass.moderators)
);

-- Per-forum category list lookup (admin / new-thread picker / list filter pill).
-- (forum_id, display_order, id) lets the listing query return categories
-- in admin-defined order with deterministic tiebreak and stay index-only.
CREATE INDEX IF NOT EXISTS idx_forum_thread_types_forum
  ON forum_thread_types(forum_id, display_order, id);

-- Thread-list filter by category: covers the
--   WHERE forum_id = ? AND type_id = ? ORDER BY last_post_at DESC, id DESC
-- shape used by /api/v1/threads?forumId=X&typeId=Y. Trailing
-- (last_post_at DESC, id DESC) mirrors the global thread-list ORDER BY
-- so the planner can stream-scan this index without a sort step.
CREATE INDEX IF NOT EXISTS idx_threads_forum_type
  ON threads(forum_id, type_id, last_post_at DESC, id DESC);
