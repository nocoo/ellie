/**
 * Upsert allowlists — columns updated on ON CONFLICT for each parent table.
 *
 * Only Discuz-sourced columns are in DO UPDATE SET; app-owned columns
 * (avatar_path, email, email_verified_at, email_normalized, email_changed_at,
 * purged_at, purged_by for users; visibility, moderator_ids, last_poster_id
 * for forums) are preserved on conflict.
 */

/** Users columns to update on conflict (Discuz-owned). */
export const USERS_UPSERT_COLUMNS: string[] = [
	"username",
	"password_hash",
	"password_salt",
	"avatar",
	"status",
	"role",
	"reg_date",
	"last_login",
	"threads",
	"posts",
	"credits",
	"coins",
	"signature",
	"group_title",
	"group_stars",
	"group_color",
	"custom_title",
	"digest_posts",
	"ol_time",
	"gender",
	"birth_year",
	"birth_month",
	"birth_day",
	"reside_province",
	"reside_city",
	"graduate_school",
	"bio",
	"interest",
	"qq",
	"site",
	"last_activity",
	"reg_ip",
	"last_ip",
	"campus",
	"has_avatar",
];

/** Checkins columns to update on conflict (all except user_id PK). */
export const CHECKINS_UPSERT_COLUMNS: string[] = [
	"total_days",
	"month_days",
	"streak_days",
	"reward_total",
	"last_reward",
	"mood",
	"message",
	"last_checkin_at",
];

/** Forums columns to update on conflict (Discuz-owned). */
export const FORUMS_UPSERT_COLUMNS: string[] = [
	"parent_id",
	"name",
	"description",
	"icon",
	"display_order",
	"threads",
	"posts",
	"type",
	"status",
	"moderators",
	"last_thread_id",
	"last_post_at",
	"last_poster",
	"last_thread_subject",
	// 主题分类 forumfield mirror — see migration 0038_thread_categories.sql.
	// Re-imports must overwrite these because the Discuz config is the
	// source of truth, not the D1 admin UI.
	"thread_types_enabled",
	"thread_types_required",
	"thread_types_listable",
	"thread_types_prefix",
];

/**
 * D1 database schema — DDL statements for creating tables and indexes.
 *
 * Directly from docs/02-database-schema.md. Tables are created in FK dependency
 * order; indexes are created after all data is loaded (per docs/03-migration.md).
 */

/** DDL statements to create all tables (no indexes). */
export const TABLE_DDL: string[] = [
	`CREATE TABLE IF NOT EXISTS forums (
  id              INTEGER PRIMARY KEY,
  parent_id       INTEGER NOT NULL DEFAULT 0,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  icon            TEXT    NOT NULL DEFAULT '',
  display_order   INTEGER NOT NULL DEFAULT 0,
  threads         INTEGER NOT NULL DEFAULT 0,
  posts           INTEGER NOT NULL DEFAULT 0,
  type            TEXT    NOT NULL DEFAULT 'forum',
  status          INTEGER NOT NULL DEFAULT 1,
  moderators      TEXT    NOT NULL DEFAULT '',
  last_thread_id  INTEGER NOT NULL DEFAULT 0,
  last_post_at    INTEGER NOT NULL DEFAULT 0,
  last_poster     TEXT    NOT NULL DEFAULT '',
  last_thread_subject TEXT NOT NULL DEFAULT '',
  thread_types_enabled  INTEGER NOT NULL DEFAULT 0,
  thread_types_required INTEGER NOT NULL DEFAULT 0,
  thread_types_listable INTEGER NOT NULL DEFAULT 0,
  thread_types_prefix   INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL DEFAULT '',
  password_salt TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  status        INTEGER NOT NULL DEFAULT 0,
  role          INTEGER NOT NULL DEFAULT 0,
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0,
  coins         INTEGER NOT NULL DEFAULT 0,
  signature     TEXT    NOT NULL DEFAULT '',
  group_title   TEXT    NOT NULL DEFAULT '',
  group_stars   INTEGER NOT NULL DEFAULT 0,
  group_color   TEXT    NOT NULL DEFAULT '',
  custom_title  TEXT    NOT NULL DEFAULT '',
  digest_posts  INTEGER NOT NULL DEFAULT 0,
  ol_time       INTEGER NOT NULL DEFAULT 0,
  gender        INTEGER NOT NULL DEFAULT 0,
  birth_year    INTEGER NOT NULL DEFAULT 0,
  birth_month   INTEGER NOT NULL DEFAULT 0,
  birth_day     INTEGER NOT NULL DEFAULT 0,
  reside_province TEXT  NOT NULL DEFAULT '',
  reside_city   TEXT    NOT NULL DEFAULT '',
  graduate_school TEXT  NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',
  interest      TEXT    NOT NULL DEFAULT '',
  qq            TEXT    NOT NULL DEFAULT '',
  site          TEXT    NOT NULL DEFAULT '',
  last_activity INTEGER NOT NULL DEFAULT 0,
  reg_ip        TEXT    NOT NULL DEFAULT '',
  last_ip       TEXT    NOT NULL DEFAULT '',
  campus        TEXT    NOT NULL DEFAULT '',
  has_avatar    INTEGER NOT NULL DEFAULT 0,
  email_verified_at INTEGER NOT NULL DEFAULT 0,
  email_normalized  TEXT    NOT NULL DEFAULT '',
  email_changed_at  INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS threads (
  id            INTEGER PRIMARY KEY,
  forum_id      INTEGER NOT NULL REFERENCES forums(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  subject       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT 0,
  last_post_at  INTEGER NOT NULL DEFAULT 0,
  last_poster   TEXT    NOT NULL DEFAULT '',
  replies       INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  closed        INTEGER NOT NULL DEFAULT 0,
  sticky        INTEGER NOT NULL DEFAULT 0,
  digest        INTEGER NOT NULL DEFAULT 0,
  special       INTEGER NOT NULL DEFAULT 0,
  highlight     INTEGER NOT NULL DEFAULT 0,
  recommends    INTEGER NOT NULL DEFAULT 0,
  post_table_id INTEGER NOT NULL DEFAULT 0,
  type_name     TEXT    NOT NULL DEFAULT '',
  type_id       INTEGER NOT NULL DEFAULT 0,
  anonymous_author       INTEGER NOT NULL DEFAULT 0,
  anonymous_last_poster  INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  forum_id      INTEGER NOT NULL REFERENCES forums(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  is_first      INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  invisible     INTEGER NOT NULL DEFAULT 0,
  anonymous     INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id),
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS post_comments (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL DEFAULT '',
  score         INTEGER NOT NULL DEFAULT 0,
  reply_post_id INTEGER NOT NULL DEFAULT 0,
  ip            TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0
)`,

	`CREATE TABLE IF NOT EXISTS user_checkins (
  user_id         INTEGER PRIMARY KEY,
  total_days      INTEGER NOT NULL DEFAULT 0,
  month_days      INTEGER NOT NULL DEFAULT 0,
  streak_days     INTEGER NOT NULL DEFAULT 0,
  reward_total    INTEGER NOT NULL DEFAULT 0,
  last_reward     INTEGER NOT NULL DEFAULT 0,
  mood            TEXT    NOT NULL DEFAULT '',
  message         TEXT    NOT NULL DEFAULT '',
  last_checkin_at INTEGER NOT NULL DEFAULT 0
)`,

	// Discuz 主题分类 (thread categories). `id` is a SYNTHETIC global id
	// minted by `migrateForumThreadTypes`; `source_typeid` preserves the
	// per-forum local Discuz typeid for admin/debug. enabled=0 = tombstone
	// (legacy threads only). See migrations 0038_thread_categories.sql +
	// 0039_thread_categories_synthetic_id.sql.
	`CREATE TABLE IF NOT EXISTS forum_thread_types (
  id              INTEGER PRIMARY KEY,
  forum_id        INTEGER NOT NULL REFERENCES forums(id),
  source_typeid   INTEGER NOT NULL DEFAULT 0,
  name            TEXT    NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  icon            TEXT    NOT NULL DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 1,
  moderator_only  INTEGER NOT NULL DEFAULT 0
)`,
];

/** DDL statements to create all indexes. Applied after data load for performance. */
export const INDEX_DDL: string[] = [
	// threads indexes
	"CREATE INDEX IF NOT EXISTS idx_threads_forum ON threads(forum_id, sticky DESC, last_post_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id, created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_threads_latest ON threads(last_post_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0",
	// Site-wide announcement cross-forum lookup (migration 0037).
	"CREATE INDEX IF NOT EXISTS idx_threads_sticky ON threads(sticky, last_post_at DESC, id DESC)",
	// Admin analytics trend bucket (migration 0041).
	"CREATE INDEX IF NOT EXISTS idx_threads_created ON threads(created_at DESC)",

	// posts indexes
	"CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, position)",
	"CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC)",
	// Admin analytics trend + per-forum distribution (migration 0041).
	"CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_posts_forum_created ON posts(forum_id, created_at DESC)",

	// users indexes
	// Admin analytics: daily new-registrations trend (migration 0041).
	"CREATE INDEX IF NOT EXISTS idx_users_reg_date ON users(reg_date)",

	// attachments indexes
	"CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id)",
	"CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id)",

	// post_comments indexes
	"CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_post_comments_thread ON post_comments(thread_id)",
	"CREATE INDEX IF NOT EXISTS idx_post_comments_author ON post_comments(author_id)",

	// user_checkins indexes
	"CREATE INDEX IF NOT EXISTS idx_user_checkins_last ON user_checkins(last_checkin_at)",

	// forum_thread_types index (admin/picker/list-filter lookup).
	// See migrations 0038 + 0039.
	"CREATE INDEX IF NOT EXISTS idx_forum_thread_types_forum ON forum_thread_types(forum_id, display_order, id)",
	// Natural-key uniqueness from 0039: (forum_id, source_typeid) is the
	// Discuz-side identity. UNIQUE catches double-mints in regression.
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_thread_types_source ON forum_thread_types(forum_id, source_typeid)",
	// Per-forum category filter (主题分类). Same migration; covers
	// `forum_id=? AND type_id=?` thread-list shape.
	"CREATE INDEX IF NOT EXISTS idx_threads_forum_type ON threads(forum_id, type_id, last_post_at DESC, id DESC)",
];

/**
 * Post-load SQL run AFTER all data is inserted AND after indexes are built.
 *
 * Use for backfills that derive denormalized values from already-loaded rows.
 * They must be idempotent (safe to re-run).
 *
 * Order is important: the second UPDATE below uses a correlated EXISTS
 * subquery on `posts`. Without `idx_posts_thread` it SCANs posts per thread
 * row, which on real-volume data (9.5M posts × 1M threads) hangs the
 * import. So callers MUST invoke this after createIndexes().
 *
 * Current contents — mig 0048 thread-anonymous mirror: posts.anonymous can
 * only land via extractPost(); threads have no anonymous column in the
 * original Discuz dump. After posts are loaded, walk back to threads and
 * mirror the flag onto the denormalized author + last_poster slots, same
 * SQL the prod migration ran by hand.
 */
export const POST_LOAD_DDL: string[] = [
	"UPDATE threads SET anonymous_author = 1 WHERE id IN (SELECT thread_id FROM posts WHERE anonymous = 1 AND is_first = 1)",
	`UPDATE threads SET anonymous_last_poster = 1
	WHERE last_poster_id != 0
	  AND EXISTS (
	    SELECT 1 FROM posts p
	    WHERE p.thread_id = threads.id
	      AND p.author_id = threads.last_poster_id
	      AND p.invisible = 0
	      AND p.anonymous = 1
	      AND p.created_at = threads.last_post_at
	  )`,
];

/** Table names in FK dependency order (for migration). */
export const TABLE_ORDER = [
	"forums",
	"users",
	"threads",
	"posts",
	"attachments",
	"post_comments",
	"user_checkins",
	"forum_thread_types",
] as const;
export type TableName = (typeof TABLE_ORDER)[number];

/** Column names for each table (in INSERT order). */
export const TABLE_COLUMNS: Record<TableName, string[]> = {
	forums: [
		"id",
		"parent_id",
		"name",
		"description",
		"icon",
		"display_order",
		"threads",
		"posts",
		"type",
		"status",
		"moderators",
		"last_thread_id",
		"last_post_at",
		"last_poster",
		"last_thread_subject",
		"thread_types_enabled",
		"thread_types_required",
		"thread_types_listable",
		"thread_types_prefix",
	],
	users: [
		"id",
		"username",
		"email",
		"password_hash",
		"password_salt",
		"avatar",
		"status",
		"role",
		"reg_date",
		"last_login",
		"threads",
		"posts",
		"credits",
		"coins",
		"signature",
		"group_title",
		"group_stars",
		"group_color",
		"custom_title",
		"digest_posts",
		"ol_time",
		"gender",
		"birth_year",
		"birth_month",
		"birth_day",
		"reside_province",
		"reside_city",
		"graduate_school",
		"bio",
		"interest",
		"qq",
		"site",
		"last_activity",
		"reg_ip",
		"last_ip",
		"campus",
		"has_avatar",
		// email_verified_at, email_normalized, email_changed_at are intentionally
		// omitted: source DZ data has no values; SQLite uses column DEFAULTs.
	],
	threads: [
		"id",
		"forum_id",
		"author_id",
		"author_name",
		"subject",
		"created_at",
		"last_post_at",
		"last_poster",
		"replies",
		"views",
		"closed",
		"sticky",
		"digest",
		"special",
		"highlight",
		"recommends",
		"post_table_id",
		"type_name",
		"type_id",
	],
	posts: [
		"id",
		"thread_id",
		"forum_id",
		"author_id",
		"author_name",
		"content",
		"created_at",
		"is_first",
		"position",
		"invisible",
		"anonymous",
	],
	attachments: [
		"id",
		"thread_id",
		"post_id",
		"author_id",
		"filename",
		"file_path",
		"file_size",
		"is_image",
		"width",
		"has_thumb",
		"downloads",
		"created_at",
	],
	post_comments: [
		"id",
		"thread_id",
		"post_id",
		"author_id",
		"author_name",
		"content",
		"score",
		"reply_post_id",
		"ip",
		"created_at",
	],
	user_checkins: [
		"user_id",
		"total_days",
		"month_days",
		"streak_days",
		"reward_total",
		"last_reward",
		"mood",
		"message",
		"last_checkin_at",
	],
	forum_thread_types: [
		"id",
		"forum_id",
		"source_typeid",
		"name",
		"display_order",
		"icon",
		"enabled",
		"moderator_only",
	],
};
