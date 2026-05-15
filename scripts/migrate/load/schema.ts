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
  last_thread_id  INTEGER NOT NULL DEFAULT 0,
  last_post_at    INTEGER NOT NULL DEFAULT 0,
  last_poster     TEXT    NOT NULL DEFAULT '',
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
  type_id       INTEGER NOT NULL DEFAULT 0
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
  invisible     INTEGER NOT NULL DEFAULT 0
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

	// posts indexes
	"CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, position)",
	"CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC)",

	// attachments indexes
	"CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id)",
	"CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id)",

	// forum_thread_types / 主题分类 (migrations 0038 + 0039).
	// idx_forum_thread_types_forum: per-forum picker/list ordering.
	// idx_forum_thread_types_source: natural-key UNIQUE on (forum_id,
	//   source_typeid) — catches double-mints of the synthetic id.
	"CREATE INDEX IF NOT EXISTS idx_forum_thread_types_forum ON forum_thread_types(forum_id, display_order, id)",
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_thread_types_source ON forum_thread_types(forum_id, source_typeid)",
	"CREATE INDEX IF NOT EXISTS idx_threads_forum_type ON threads(forum_id, type_id, last_post_at DESC, id DESC)",
];

/** Table names in FK dependency order (for migration). */
export const TABLE_ORDER = [
	"forums",
	"users",
	"threads",
	"posts",
	"attachments",
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
		"last_thread_id",
		"last_post_at",
		"last_poster",
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
