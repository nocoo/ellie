// D1 schema definitions (aligned with docs/02-database-schema.md)

export const TABLES = {
	forums: `
		CREATE TABLE IF NOT EXISTS forums (
			id INTEGER PRIMARY KEY,
			parent_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			icon TEXT NOT NULL DEFAULT '',
			display_order INTEGER NOT NULL DEFAULT 0,
			threads INTEGER NOT NULL DEFAULT 0,
			posts INTEGER NOT NULL DEFAULT 0,
			type TEXT NOT NULL DEFAULT 'forum',
			status INTEGER NOT NULL DEFAULT 1,
			visibility TEXT NOT NULL DEFAULT 'public'
				CHECK(visibility IN ('public', 'members', 'staff', 'admin')),
			moderators TEXT NOT NULL DEFAULT '',
			moderator_ids TEXT NOT NULL DEFAULT '',
			last_thread_id INTEGER NOT NULL DEFAULT 0,
			last_post_at INTEGER NOT NULL DEFAULT 0,
			last_poster TEXT NOT NULL DEFAULT '',
			last_poster_id INTEGER NOT NULL DEFAULT 0,
			last_thread_subject TEXT NOT NULL DEFAULT '',
			thread_types_enabled  INTEGER NOT NULL DEFAULT 0,
			thread_types_required INTEGER NOT NULL DEFAULT 0,
			thread_types_listable INTEGER NOT NULL DEFAULT 0,
			thread_types_prefix   INTEGER NOT NULL DEFAULT 0
		);
	`,

	users: `
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			email TEXT NOT NULL DEFAULT '',
			password_hash TEXT NOT NULL DEFAULT '',
			password_salt TEXT NOT NULL DEFAULT '',
			avatar TEXT NOT NULL DEFAULT '',
			status INTEGER NOT NULL DEFAULT 0,
			role INTEGER NOT NULL DEFAULT 0,
			reg_date INTEGER NOT NULL DEFAULT 0,
			last_login INTEGER NOT NULL DEFAULT 0,
			threads INTEGER NOT NULL DEFAULT 0,
			posts INTEGER NOT NULL DEFAULT 0,
			credits INTEGER NOT NULL DEFAULT 0,
			coins INTEGER NOT NULL DEFAULT 0,
			signature TEXT NOT NULL DEFAULT '',
			group_title TEXT NOT NULL DEFAULT '',
			group_stars INTEGER NOT NULL DEFAULT 0,
			group_color TEXT NOT NULL DEFAULT '',
			custom_title TEXT NOT NULL DEFAULT '',
			digest_posts INTEGER NOT NULL DEFAULT 0,
			ol_time INTEGER NOT NULL DEFAULT 0,
			gender INTEGER NOT NULL DEFAULT 0,
			birth_year INTEGER NOT NULL DEFAULT 0,
			birth_month INTEGER NOT NULL DEFAULT 0,
			birth_day INTEGER NOT NULL DEFAULT 0,
			reside_province TEXT NOT NULL DEFAULT '',
			reside_city TEXT NOT NULL DEFAULT '',
			graduate_school TEXT NOT NULL DEFAULT '',
			bio TEXT NOT NULL DEFAULT '',
			interest TEXT NOT NULL DEFAULT '',
			qq TEXT NOT NULL DEFAULT '',
			site TEXT NOT NULL DEFAULT '',
			last_activity INTEGER NOT NULL DEFAULT 0,
			has_avatar INTEGER NOT NULL DEFAULT 0,
			avatar_path TEXT NOT NULL DEFAULT '',
			email_verified_at INTEGER NOT NULL DEFAULT 0,
			email_normalized TEXT NOT NULL DEFAULT '',
			email_changed_at INTEGER NOT NULL DEFAULT 0
		);
	`,

	threads: `
		CREATE TABLE IF NOT EXISTS threads (
			id INTEGER PRIMARY KEY,
			forum_id INTEGER NOT NULL,
			author_id INTEGER NOT NULL,
			author_name TEXT NOT NULL,
			subject TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			last_post_at INTEGER NOT NULL,
			last_poster TEXT NOT NULL,
			last_poster_id INTEGER NOT NULL DEFAULT 0,
			replies INTEGER NOT NULL DEFAULT 0,
			views INTEGER NOT NULL DEFAULT 0,
			closed INTEGER NOT NULL DEFAULT 0,
			sticky INTEGER NOT NULL DEFAULT 0,
			digest INTEGER NOT NULL DEFAULT 0,
			special INTEGER NOT NULL DEFAULT 0,
			highlight INTEGER NOT NULL DEFAULT 0,
			recommends INTEGER NOT NULL DEFAULT 0,
			post_table_id INTEGER NOT NULL DEFAULT 0,
			type_name TEXT NOT NULL DEFAULT '',
			type_id INTEGER NOT NULL DEFAULT 0
		);
	`,

	posts: `
		CREATE TABLE IF NOT EXISTS posts (
			id INTEGER PRIMARY KEY,
			thread_id INTEGER NOT NULL,
			forum_id INTEGER NOT NULL,
			author_id INTEGER NOT NULL,
			author_name TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			is_first INTEGER NOT NULL DEFAULT 0,
			position INTEGER NOT NULL DEFAULT 0,
			invisible INTEGER NOT NULL DEFAULT 0
		);
	`,

	attachments: `
		CREATE TABLE IF NOT EXISTS attachments (
			id INTEGER PRIMARY KEY,
			thread_id INTEGER NOT NULL,
			post_id INTEGER NOT NULL,
			author_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			file_path TEXT NOT NULL,
			file_size INTEGER NOT NULL,
			is_image INTEGER NOT NULL DEFAULT 0,
			width INTEGER NOT NULL DEFAULT 0,
			has_thumb INTEGER NOT NULL DEFAULT 0,
			downloads INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);
	`,

	ip_bans: `
		CREATE TABLE IF NOT EXISTS ip_bans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ip TEXT NOT NULL,
			admin_id INTEGER NOT NULL,
			admin_name TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			expires_at INTEGER,
			created_at INTEGER NOT NULL
		);
	`,

	censor_words: `
		CREATE TABLE IF NOT EXISTS censor_words (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			find TEXT NOT NULL,
			replacement TEXT NOT NULL DEFAULT '**',
			action TEXT NOT NULL DEFAULT 'replace' CHECK(action IN ('ban', 'replace')),
			admin_id INTEGER NOT NULL,
			admin_name TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);
	`,

	settings: `
		CREATE TABLE IF NOT EXISTS settings (
			id    INTEGER PRIMARY KEY AUTOINCREMENT,
			key   TEXT NOT NULL UNIQUE,
			value TEXT NOT NULL DEFAULT '',
			type  TEXT NOT NULL DEFAULT 'string'
			      CHECK(type IN ('string', 'number', 'boolean', 'json')),
			updated_at INTEGER NOT NULL DEFAULT 0
		);
	`,

	reports: `
		CREATE TABLE IF NOT EXISTS reports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL CHECK(type IN ('thread', 'post', 'user')),
			target_id INTEGER NOT NULL,
			reporter_id INTEGER NOT NULL,
			reporter_name TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending'
			       CHECK(status IN ('pending', 'resolved', 'dismissed')),
			handler_id INTEGER,
			handler_name TEXT NOT NULL DEFAULT '',
			handled_at INTEGER,
			created_at INTEGER NOT NULL
		);
	`,

	admin_logs: `
		CREATE TABLE IF NOT EXISTS admin_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_id INTEGER NOT NULL,
			admin_name TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT '',
			target_id INTEGER,
			details TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);
	`,

	announcements: `
		CREATE TABLE IF NOT EXISTS announcements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			forum_ids TEXT NOT NULL DEFAULT '',
			sticky INTEGER NOT NULL DEFAULT 0,
			start_at INTEGER,
			end_at INTEGER,
			status INTEGER NOT NULL DEFAULT 1,
			author_id INTEGER NOT NULL,
			author_name TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL DEFAULT 0
		);
	`,

	messages: `
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sender_id INTEGER NOT NULL,
			sender_name TEXT NOT NULL,
			receiver_id INTEGER NOT NULL,
			receiver_name TEXT NOT NULL,
			subject TEXT NOT NULL DEFAULT '',
			content TEXT NOT NULL,
			is_read INTEGER NOT NULL DEFAULT 0,
			sender_deleted INTEGER NOT NULL DEFAULT 0,
			receiver_deleted INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);
	`,

	user_checkins: `
		CREATE TABLE IF NOT EXISTS user_checkins (
			user_id         INTEGER PRIMARY KEY,
			total_days      INTEGER NOT NULL DEFAULT 0,
			month_days      INTEGER NOT NULL DEFAULT 0,
			streak_days     INTEGER NOT NULL DEFAULT 0,
			reward_total    INTEGER NOT NULL DEFAULT 0,
			last_reward     INTEGER NOT NULL DEFAULT 0,
			mood            TEXT    NOT NULL DEFAULT '',
			message         TEXT    NOT NULL DEFAULT '',
			last_checkin_at INTEGER NOT NULL DEFAULT 0
		);
	`,

	// Per-day check-in audit log (mirror of migration 0036). The aggregate
	// `user_checkins` row above keeps rolling totals; this table records one
	// row per actual check-in keyed by Asia/Shanghai local day in
	// `YYYY-MM-DD` text form. Composite PK (user_id, date_local) gives the
	// at-most-one-per-day uniqueness the public POST handler relies on via
	// `ON CONFLICT(user_id, date_local) DO NOTHING`.
	checkin_history: `
		CREATE TABLE IF NOT EXISTS checkin_history (
			user_id    INTEGER NOT NULL,
			date_local TEXT    NOT NULL,
			mood       TEXT    NOT NULL DEFAULT '',
			message    TEXT    NOT NULL DEFAULT '',
			reward     INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, date_local)
		);
	`,

	// Discuz 主题分类 (thread categories). `id` is a SYNTHETIC global id
	// minted by `migrateForumThreadTypes`; `source_typeid` preserves the
	// per-forum local Discuz typeid for admin/debug. enabled=0 rows are
	// tombstones — kept so the legacy threads they reference can still
	// resolve a typeName, but hidden from the admin/post-picker UIs.
	// See migrations 0038_thread_categories.sql + 0039_thread_categories_synthetic_id.sql.
	forum_thread_types: `
		CREATE TABLE IF NOT EXISTS forum_thread_types (
			id              INTEGER PRIMARY KEY,
			forum_id        INTEGER NOT NULL,
			source_typeid   INTEGER NOT NULL DEFAULT 0,
			name            TEXT    NOT NULL,
			display_order   INTEGER NOT NULL DEFAULT 0,
			icon            TEXT    NOT NULL DEFAULT '',
			enabled         INTEGER NOT NULL DEFAULT 1,
			moderator_only  INTEGER NOT NULL DEFAULT 0
		);
	`,

	// Mirror of migration 0040_create_post_ratings.sql. One row per active
	// or revoked rating event (post 评分). The partial unique index on
	// (rater_id, post_id, dimension) WHERE revoked_at=0 enforces the
	// "one active rating per dimension" rule and intentionally lets a
	// revoked row be replaced by a fresh one. See docs/22-post-rating.md §5.1.
	post_ratings: `
		CREATE TABLE IF NOT EXISTS post_ratings (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			post_id     INTEGER NOT NULL,
			thread_id   INTEGER NOT NULL,
			rater_id    INTEGER NOT NULL,
			rater_name  TEXT    NOT NULL,
			dimension   INTEGER NOT NULL,
			score       INTEGER NOT NULL,
			reason      TEXT    NOT NULL DEFAULT '',
			created_at  INTEGER NOT NULL,
			revoked_at  INTEGER NOT NULL DEFAULT 0,
			revoked_by  INTEGER NOT NULL DEFAULT 0
		);
	`,

	// Mirror of migration 0042_create_login_history.sql. Per-attempt audit
	// log appended by `auth.ts` login/register handlers AFTER trust-edge
	// resolution. Runtime-only audit table — not imported from MySQL.
	// Powers the admin analytics "今日登录" KPI + masked detail list +
	// audit-logged reveal endpoint. See
	// `apps/worker/src/lib/analytics/loginHistory.ts` for the
	// schedule-then-waitUntil call-site contract; failures MUST NEVER
	// reach the response path.
	login_history: `
		CREATE TABLE IF NOT EXISTS login_history (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id     INTEGER,
			username    TEXT    NOT NULL,
			ok          INTEGER NOT NULL,
			kind        TEXT    NOT NULL,
			error_code  TEXT    NOT NULL DEFAULT '',
			ip          TEXT    NOT NULL DEFAULT '',
			user_agent  TEXT    NOT NULL DEFAULT '',
			bot_class   TEXT    NOT NULL DEFAULT 'unknown',
			created_at  INTEGER NOT NULL
		);
	`,

	// Mirror of migration 0043_create_analytics_daily_targets.sql. Per
	// (date_local, path_kind, target_id, user_id, bot_class) page-view
	// counter, written via UPSERT by the worker collector flush sink and
	// swept on a 48h cron. Powers the admin "今日访问名单" KPI + list
	// panel. Runtime-only counter table — NOT imported from MySQL.
	// `count` is monotonically incremented; `last_seen_at` drives the
	// retention sweep. No label / ip / ua columns — list endpoint
	// resolves target labels by batched lookup at read time so renames
	// in source data do NOT corrupt historical aggregates.
	analytics_daily_targets: `
		CREATE TABLE IF NOT EXISTS analytics_daily_targets (
			date_local      TEXT    NOT NULL,
			path_kind       TEXT    NOT NULL,
			target_id       INTEGER NOT NULL,
			user_id         INTEGER NOT NULL,
			bot_class       TEXT    NOT NULL,
			count           INTEGER NOT NULL DEFAULT 0,
			first_seen_at   INTEGER NOT NULL,
			last_seen_at    INTEGER NOT NULL,
			PRIMARY KEY (date_local, path_kind, target_id, user_id, bot_class)
		);
	`,
};

export const INDEXES = {
	forums: [
		"CREATE INDEX IF NOT EXISTS idx_forums_parent ON forums(parent_id);",
		"CREATE INDEX IF NOT EXISTS idx_forums_display_order ON forums(display_order);",
		"CREATE INDEX IF NOT EXISTS idx_forums_last_poster_id ON forums(last_poster_id);",
		"CREATE INDEX IF NOT EXISTS idx_forums_visibility ON forums(visibility);",
	],

	users: [
		"CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);",
		"CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);",
		// Mirrors migration 0029_email_normalized_unique_index.sql. The
		// partial WHERE leaves legacy/cleared rows (email_normalized = '')
		// unconstrained so they can later claim an email via the verify
		// flow. Drift guard: tests/unit/migration-0029-schema.test.ts pins
		// this string to the migration file.
		"CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uniq ON users(email_normalized) WHERE email_normalized != '';",
		// Admin analytics: daily new-registrations trend bucket. See
		// migration 0041_idx_analytics_trend.sql. Drift guard:
		// tests/unit/migration-0041-schema.test.ts.
		"CREATE INDEX IF NOT EXISTS idx_users_reg_date ON users(reg_date);",
	],

	threads: [
		"CREATE INDEX IF NOT EXISTS idx_threads_forum ON threads(forum_id, last_post_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id);",
		"CREATE INDEX IF NOT EXISTS idx_threads_latest ON threads(last_post_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_threads_last_poster_id ON threads(last_poster_id);",
		// Site-wide announcement (sticky=2) cross-forum lookup. See
		// migration 0037_idx_threads_sticky.sql; the OR'd WHERE in
		// /api/v1/threads needs this to avoid a full-table scan.
		"CREATE INDEX IF NOT EXISTS idx_threads_sticky ON threads(sticky, last_post_at DESC, id DESC);",
		// Per-forum category filter (主题分类). See migration
		// 0038_thread_categories.sql; covers the `forum_id=? AND type_id=?`
		// thread-list query shape index-only including the ORDER BY.
		"CREATE INDEX IF NOT EXISTS idx_threads_forum_type ON threads(forum_id, type_id, last_post_at DESC, id DESC);",
		// Admin analytics: daily new-threads trend bucket. See migration
		// 0041_idx_analytics_trend.sql.
		"CREATE INDEX IF NOT EXISTS idx_threads_created ON threads(created_at DESC);",
	],

	posts: [
		"CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, created_at);",
		"CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);",
		// Admin analytics: daily posts trend + per-forum distribution.
		// See migration 0041_idx_analytics_trend.sql.
		"CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_posts_forum_created ON posts(forum_id, created_at DESC);",
	],

	attachments: [
		"CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);",
		"CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);",
	],

	ip_bans: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_bans_ip ON ip_bans(ip);"],

	censor_words: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_censor_words_find ON censor_words(find);"],

	settings: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);"],

	reports: [
		"CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);",
		"CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);",
		"CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(type, target_id);",
		"CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);",
		"CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);",
	],

	admin_logs: [
		"CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);",
		"CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);",
		"CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_type, target_id);",
		"CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);",
	],

	announcements: [
		"CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);",
		"CREATE INDEX IF NOT EXISTS idx_announcements_dates ON announcements(start_at, end_at);",
		"CREATE INDEX IF NOT EXISTS idx_announcements_sticky ON announcements(sticky DESC, created_at DESC);",
	],

	messages: [
		"CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);",
	],

	user_checkins: [
		"CREATE INDEX IF NOT EXISTS idx_user_checkins_last ON user_checkins(last_checkin_at);",
	],

	// Mirror of migration 0036 — admin date-range queries on
	// `checkin_history` filter by `date_local` first; the composite PK
	// already covers the per-user lookup path.
	checkin_history: [
		"CREATE INDEX IF NOT EXISTS idx_checkin_history_date ON checkin_history(date_local);",
	],

	// Per-forum category list (admin / picker / list-filter pill).
	// Composite (forum_id, display_order, id) lets the picker query
	// return rows in admin-defined order with a deterministic tiebreak
	// and stay index-only. See migration 0038_thread_categories.sql.
	forum_thread_types: [
		"CREATE INDEX IF NOT EXISTS idx_forum_thread_types_forum ON forum_thread_types(forum_id, display_order, id);",
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_thread_types_source ON forum_thread_types(forum_id, source_typeid);",
	],

	// Post ratings (评分) — mirrors migration 0040. Composite
	// (post_id, revoked_at, created_at) covers the per-post aggregate +
	// hover-list read; partial indexes on the active subset keep both
	// the rolling-24h quota scan and the "one active rating per
	// (rater, post, dim)" uniqueness tight. See docs/22-post-rating.md §5.1.
	post_ratings: [
		"CREATE INDEX IF NOT EXISTS idx_post_ratings_post ON post_ratings(post_id, revoked_at, created_at);",
		"CREATE INDEX IF NOT EXISTS idx_post_ratings_thread ON post_ratings(thread_id, revoked_at, created_at);",
		"CREATE INDEX IF NOT EXISTS idx_post_ratings_rater_dim_time ON post_ratings(rater_id, dimension, created_at) WHERE revoked_at = 0;",
		"CREATE UNIQUE INDEX IF NOT EXISTS uq_post_ratings_active ON post_ratings(rater_id, post_id, dimension) WHERE revoked_at = 0;",
	],

	// Login history (mirror of migration 0042). Three time-leading
	// indexes cover the dashboard read paths; a partial index over
	// failure rows keeps the active subset of `error_code != ''` tight
	// for the "失败明细" filter. Drift guard:
	// tests/unit/migration-0042-schema.test.ts pins the partial WHERE.
	login_history: [
		"CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_login_history_user_created ON login_history(user_id, created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_login_history_kind_created ON login_history(kind, created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_login_history_error_created ON login_history(error_code, created_at DESC) WHERE error_code != '';",
	],

	// analytics_daily_targets (mirror of migration 0043). List endpoint
	// shape: WHERE date_local=? AND path_kind=? GROUP BY target_id ⇒
	// covering composite index. Retention sweep: DELETE WHERE
	// last_seen_at < cutoff ⇒ leading-column index. Drift guard:
	// tests/unit/migration-0043-schema.test.ts pins both shapes.
	analytics_daily_targets: [
		"CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_list ON analytics_daily_targets(date_local, path_kind, target_id);",
		"CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_last_seen ON analytics_daily_targets(last_seen_at);",
	],
};
