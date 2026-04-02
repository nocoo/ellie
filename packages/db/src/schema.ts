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
			moderators TEXT NOT NULL DEFAULT '',
			last_thread_id INTEGER NOT NULL DEFAULT 0,
			last_post_at INTEGER NOT NULL DEFAULT 0,
			last_poster TEXT NOT NULL DEFAULT '',
			last_poster_id INTEGER NOT NULL DEFAULT 0,
			last_thread_subject TEXT NOT NULL DEFAULT ''
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
			last_activity INTEGER NOT NULL DEFAULT 0
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
			type_name TEXT NOT NULL DEFAULT ''
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
			position INTEGER NOT NULL DEFAULT 0
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
};

export const INDEXES = {
	forums: [
		"CREATE INDEX IF NOT EXISTS idx_forums_parent ON forums(parent_id);",
		"CREATE INDEX IF NOT EXISTS idx_forums_display_order ON forums(display_order);",
		"CREATE INDEX IF NOT EXISTS idx_forums_last_poster_id ON forums(last_poster_id);",
	],

	users: [
		"CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);",
		"CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);",
	],

	threads: [
		"CREATE INDEX IF NOT EXISTS idx_threads_forum ON threads(forum_id, last_post_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id);",
		"CREATE INDEX IF NOT EXISTS idx_threads_latest ON threads(last_post_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_threads_last_poster_id ON threads(last_poster_id);",
	],

	posts: [
		"CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, created_at);",
		"CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);",
	],

	attachments: [
		"CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);",
		"CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);",
	],

	ip_bans: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_bans_ip ON ip_bans(ip);"],

	censor_words: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_censor_words_find ON censor_words(find);"],

	settings: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);"],
};
