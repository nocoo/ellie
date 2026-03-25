# Database Schema

Cloudflare D1 schema for Ellie, mapped from Discuz! X3.4.

Source: `tongji.nocoo.cloud` — MySQL 8.0.42, databases `db_tongji_main` and `db_tongji_ucenter`.

## Overview

Discuz X3.4 has 200+ tables. Ellie only migrates the core forum data:

| Ellie Table | Discuz Source | Purpose |
|-------------|---------------|---------|
| `users` | `uc_members` + `pre_common_member` + `pre_common_member_count` | User accounts |
| `forums` | `pre_forum_forum` + `pre_forum_forumfield` | Forum categories and boards |
| `threads` | `pre_forum_thread` | Thread (topic) metadata |
| `posts` | `pre_forum_post` + `pre_forum_post_1~4` | Post content (first post + replies) |
| `attachments` | `pre_forum_attachment` (index) + `pre_forum_attachment_0~9` (shards) | File attachments |

> Full schema of all DZ tables is at `reference/db/schema_all.sql.gz` for reference.

### Database layout

```
db_tongji_ucenter          db_tongji_main
├── uc_members             ├── pre_common_member
│   (uid, username,        │   (uid, username, email, status,
│    password, salt,       │    adminid, groupid, avatarstatus,
│    email, regip,         │    regdate, credits, freeze ...)
│    lastlogintime ...)    │
│                          ├── pre_common_member_count
│                          │   (uid, threads, posts,
│                          │    digestposts, extcredits1~8 ...)
│                          │
│                          ├── pre_forum_forum + pre_forum_forumfield
│                          ├── pre_forum_thread
│                          ├── pre_forum_post (main) + _1 ~ _4 (shards)
│                          └── pre_forum_attachment (index) + _0 ~ _9 (shards)
```

---

## D1 Schema

### users

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,  -- DZ uid
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL DEFAULT '',
  password_salt TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  status        INTEGER NOT NULL DEFAULT 0,   -- 0=normal, -1=banned
  role          INTEGER NOT NULL DEFAULT 0,   -- 0=user, 1=admin, 2=super-mod, 3=mod
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0
);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_common_member` | `uid` | mediumint unsigned PK | Also PK in `uc_members` (same uid space) |
| `username` | `uc_members` | `username` | char(15) | In `db_tongji_ucenter`. `pre_common_member` also has `username` |
| `email` | `uc_members` | `email` | char(32) | `pre_common_member.email` is char(40), prefer ucenter as auth source |
| `password_hash` | `uc_members` | `password` | char(32) | `md5(md5(password) + salt)` — see below |
| `password_salt` | `uc_members` | `salt` | char(6) | 6-char random string |
| `avatar` | — | Computed from `uid` | — | `data/avatar/{uid%16}/{uid%256}/{uid}_avatar_big.jpg` |
| `status` | `pre_common_member` | `status` | tinyint(1) | `0`=normal, `-1`=banned. Also check `freeze` field |
| `role` | `pre_common_member` | `adminid` | tinyint(1) | `0`=user, `1`=admin, `2`=super-mod, `3`=mod |
| `reg_date` | `pre_common_member` | `regdate` | int unsigned | Unix timestamp |
| `last_login` | `uc_members` | `lastlogintime` | int unsigned | Unix timestamp |
| `threads` | `pre_common_member_count` | `threads` | mediumint unsigned | ⚠️ NOT in `pre_common_member` — separate table, join on `uid` |
| `posts` | `pre_common_member_count` | `posts` | mediumint unsigned | ⚠️ NOT in `pre_common_member` — separate table, join on `uid` |
| `credits` | `pre_common_member` | `credits` | int | |

**Migration query:**

```sql
SELECT
  m.uid, uc.username, uc.email, uc.password, uc.salt,
  m.status, m.adminid, m.regdate, m.avatarstatus,
  uc.lastlogintime,
  COALESCE(mc.threads, 0) AS threads,
  COALESCE(mc.posts, 0) AS posts,
  m.credits
FROM db_tongji_main.pre_common_member m
JOIN db_tongji_ucenter.uc_members uc ON uc.uid = m.uid
LEFT JOIN db_tongji_main.pre_common_member_count mc ON mc.uid = m.uid
WHERE m.status >= 0    -- exclude banned
  AND m.freeze = 0;    -- exclude frozen
```

**Useful filter fields (not migrated as columns but used during migration):**

| Field | Table | Notes |
|-------|-------|-------|
| `avatarstatus` | `pre_common_member` | `0`=no avatar, `1`=has avatar — skip avatar migration for users without one |
| `freeze` | `pre_common_member` | `0`=normal, `1`=frozen — may filter or flag |
| `groupid` | `pre_common_member` | User group ID — determines permission level in DZ |

**Password verification (legacy):**

```
stored_hash == md5(md5(user_input) + stored_salt)
```

On successful login, silently upgrade to argon2id and clear `password_salt`.

---

### forums

```sql
CREATE TABLE forums (
  id              INTEGER PRIMARY KEY,  -- DZ fid
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
  last_poster     TEXT    NOT NULL DEFAULT ''
);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_forum` | `fid` | mediumint unsigned PK | |
| `parent_id` | `pre_forum_forum` | `fup` | mediumint unsigned | `0` = top-level category |
| `name` | `pre_forum_forum` | `name` | char(50) | |
| `description` | `pre_forum_forumfield` | `description` | text | Separate table, join on `fid` |
| `icon` | `pre_forum_forumfield` | `icon` | varchar(255) | Forum icon path |
| `display_order` | `pre_forum_forum` | `displayorder` | smallint | |
| `threads` | `pre_forum_forum` | `threads` | mediumint unsigned | |
| `posts` | `pre_forum_forum` | `posts` | mediumint unsigned | |
| `type` | `pre_forum_forum` | `type` | enum('group','forum','sub') | `group`=category, `forum`=board, `sub`=sub-board |
| `status` | `pre_forum_forum` | `status` | tinyint(1) | `0`=hidden, `1`=normal. Filter hidden forums |
| `last_thread_id` | `pre_forum_forum` | `lastpost` | char(110) | Parsed from `lastpost` field (format: `tid\tsubject\ttimestamp\tposter`) |
| `last_post_at` | `pre_forum_forum` | `lastpost` | char(110) | Timestamp portion of `lastpost` |
| `last_poster` | `pre_forum_forum` | `lastpost` | char(110) | Poster portion of `lastpost` |

**Hierarchy:** `group` (category) → `forum` (board) → `sub` (sub-board). `parent_id` points to the parent `fid`.

**Migration query:**

```sql
SELECT
  f.fid, f.fup, f.name, ff.description, ff.icon,
  f.displayorder, f.threads, f.posts, f.type, f.status,
  f.lastpost  -- char(110), format: "tid\tsubject\ttimestamp\tposter"
FROM pre_forum_forum f
LEFT JOIN pre_forum_forumfield ff ON ff.fid = f.fid
WHERE f.status = 1;
-- Parse f.lastpost in application code to extract last_thread_id, last_post_at, last_poster
```

---

### threads

```sql
CREATE TABLE threads (
  id            INTEGER PRIMARY KEY,  -- DZ tid
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
  post_table_id INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_threads_forum ON threads(forum_id, sticky DESC, last_post_at DESC);
CREATE INDEX idx_threads_author ON threads(author_id, created_at DESC);
CREATE INDEX idx_threads_latest ON threads(last_post_at DESC);
CREATE INDEX idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0;
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_thread` | `tid` | mediumint unsigned PK | |
| `forum_id` | `pre_forum_thread` | `fid` | mediumint unsigned | |
| `author_id` | `pre_forum_thread` | `authorid` | mediumint unsigned | |
| `author_name` | `pre_forum_thread` | `author` | char(15) | Denormalized username |
| `subject` | `pre_forum_thread` | `subject` | char(80) | |
| `created_at` | `pre_forum_thread` | `dateline` | int unsigned | Unix timestamp |
| `last_post_at` | `pre_forum_thread` | `lastpost` | int unsigned | Unix timestamp |
| `last_poster` | `pre_forum_thread` | `lastposter` | char(15) | Last replier's username |
| `replies` | `pre_forum_thread` | `replies` | mediumint unsigned | |
| `views` | `pre_forum_thread` | `views` | int unsigned | |
| `closed` | `pre_forum_thread` | `closed` | mediumint unsigned | `0`=open, `1`=closed, `>1`=merged into thread tid=closed |
| `sticky` | `pre_forum_thread` | `displayorder` | tinyint(1) | `0`=normal, `1`=sticky, `2`=global sticky, `3`=category sticky |
| `digest` | `pre_forum_thread` | `digest` | tinyint(1) | `0`=no, `1~3`=digest level |
| `special` | `pre_forum_thread` | `special` | tinyint(1) | `0`=normal, `1`=poll, `2`=trade, `3`=reward, `4`=activity, `5`=debate |
| `highlight` | `pre_forum_thread` | `highlight` | tinyint(1) | Title style encoding (color/bold/italic) |
| `recommends` | `pre_forum_thread` | `recommends` | smallint | Net upvotes (recommend_add - recommend_sub) |
| `post_table_id` | `pre_forum_thread` | `posttableid` | smallint unsigned | ⚠️ Which `pre_forum_post_N` shard holds this thread's replies. `0` = main table |

**Key semantics for `closed`:**

```
closed == 0     → thread is open
closed == 1     → thread is closed (locked)
closed > 1      → thread was merged into thread with tid = closed
```

When `closed > 1`, the thread is effectively a redirect. Migration should either skip or create a redirect record.

**Post sharding:** DZ distributes post data across `pre_forum_post` (main, posttableid=0) and `pre_forum_post_1` through `pre_forum_post_4` (on this instance). The `posttableid` field determines which table to query. Migration must read from ALL post tables.

---

### posts

```sql
CREATE TABLE posts (
  id            INTEGER PRIMARY KEY,  -- DZ pid
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  forum_id      INTEGER NOT NULL REFERENCES forums(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  is_first      INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_posts_thread ON posts(thread_id, position);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_post[_N]` | `pid` | int unsigned | UNIQUE KEY (not PK in DZ — DZ PK is `(tid, position)`) |
| `thread_id` | `pre_forum_post[_N]` | `tid` | mediumint unsigned | |
| `forum_id` | `pre_forum_post[_N]` | `fid` | mediumint unsigned | |
| `author_id` | `pre_forum_post[_N]` | `authorid` | mediumint unsigned | |
| `author_name` | `pre_forum_post[_N]` | `author` | varchar(15) | |
| `content` | `pre_forum_post[_N]` | `message` | mediumtext | ⚠️ BBCode → HTML conversion needed — see content format below |
| `created_at` | `pre_forum_post[_N]` | `dateline` | int unsigned | Unix timestamp |
| `is_first` | `pre_forum_post[_N]` | `first` | tinyint(1) | `1`=thread opener, `0`=reply |
| `position` | `pre_forum_post[_N]` | `position` | int unsigned | Floor number (1-based, AUTO_INCREMENT) |

**Critical filter fields (used during migration, not stored):**

| Field | Type | Notes |
|-------|------|-------|
| `invisible` | tinyint(1) | `0`=visible, `-1`=pending review, `-5`=ignored. **Only migrate `invisible = 0`** |
| `htmlon` | tinyint(1) | `1`=HTML enabled in this post. If on, `message` may contain raw HTML |
| `bbcodeoff` | tinyint(1) | `1`=BBCode disabled. If on, `[tags]` in message are literal text, not BBCode |

**Post table distribution (this instance):**

| Table | Rows | posttableid |
|-------|------|-------------|
| `pre_forum_post` (main) | 6,234,374 | `0` |
| `pre_forum_post_1` | 716,601 | `1` |
| `pre_forum_post_2` | 823,776 | `2` |
| `pre_forum_post_3` | 862,397 | `3` |
| `pre_forum_post_4` | 873,734 | `4` |
| **Total** | **9,510,882** | |

**Migration query (per table):**

```sql
-- Repeat for each post table: pre_forum_post, pre_forum_post_1 ... pre_forum_post_4
SELECT pid, tid, fid, authorid, author, message, dateline, first, position,
       invisible, htmlon, bbcodeoff
FROM pre_forum_post
WHERE invisible = 0;
```

**Content format:**

DZ stores BBCode in `message`. Before converting, check per-post flags:
- If `bbcodeoff = 1`: treat `message` as plain text (no BBCode parsing)
- If `htmlon = 1`: `message` may contain raw HTML mixed with BBCode

BBCode → HTML conversion table:

| BBCode | HTML |
|--------|------|
| `[b]text[/b]` | `<strong>text</strong>` |
| `[i]text[/i]` | `<em>text</em>` |
| `[u]text[/u]` | `<u>text</u>` |
| `[url=href]text[/url]` | `<a href="href">text</a>` |
| `[img]src[/img]` | `<img src="src">` |
| `[quote]text[/quote]` | `<blockquote>text</blockquote>` |
| `[code]text[/code]` | `<pre><code>text</code></pre>` |
| `[color=red]text[/color]` | `<span style="color:red">text</span>` |
| `[size=4]text[/size]` | `<span style="font-size:...">text</span>` |
| `[attach]aid[/attach]` | Resolve to attachment URL via `attachments` table |

---

### attachments

```sql
CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY,  -- DZ aid
  thread_id   INTEGER NOT NULL REFERENCES threads(id),
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,     -- R2 object key after migration
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_attachments_post ON attachments(post_id);
CREATE INDEX idx_attachments_thread ON attachments(thread_id);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_attachment` | `aid` | mediumint unsigned PK | From the **index table** |
| `thread_id` | `pre_forum_attachment_N` | `tid` | mediumint unsigned | |
| `post_id` | `pre_forum_attachment_N` | `pid` | int unsigned | |
| `author_id` | `pre_forum_attachment_N` | `uid` | mediumint unsigned | |
| `filename` | `pre_forum_attachment_N` | `filename` | varchar(255) | Original upload name |
| `file_path` | `pre_forum_attachment_N` | `attachment` | varchar(255) | DZ relative path → R2 key |
| `file_size` | `pre_forum_attachment_N` | `filesize` | int unsigned | Bytes |
| `is_image` | `pre_forum_attachment_N` | `isimage` | tinyint(1) | `0`=no, `1`=yes (NOT -1/1) |
| `width` | `pre_forum_attachment_N` | `width` | smallint unsigned | Image width in px, `0` for non-images |
| `has_thumb` | `pre_forum_attachment_N` | `thumb` | tinyint unsigned | `0`=no thumbnail, `1`=has thumbnail |
| `downloads` | `pre_forum_attachment` | `downloads` | mediumint | ⚠️ On the **index table**, NOT the shard tables |
| `created_at` | `pre_forum_attachment_N` | `dateline` | int unsigned | Unix timestamp |

**Attachment sharding architecture:**

```
pre_forum_attachment (index table)
├── aid (PK)
├── tid, pid, uid
├── downloads        ← download count lives HERE
└── tableid          ← which shard table (0~9)

pre_forum_attachment_0 ~ _9 (shard tables)
├── aid (PK, matches index table)
├── tid, pid, uid
├── filename, filesize, attachment (path)
├── dateline
├── isimage, width, thumb
├── remote           ← 0=local, 1=remote FTP, 2=remote
├── description      ← attachment description text
├── readperm, price  ← access control
└── sha1             ← file hash for dedup/integrity
```

**Shard lookup:** Use `pre_forum_attachment.tableid` to determine which `_N` table to query. Do NOT assume `tid % 10` — use the `tableid` field.

**Migration query:**

```sql
SELECT
  a.aid, s.tid, s.pid, s.uid, s.filename, s.attachment, s.filesize,
  s.isimage, s.width, s.thumb, a.downloads, s.dateline,
  s.remote, s.sha1
FROM pre_forum_attachment a
JOIN pre_forum_attachment_0 s ON s.aid = a.aid
WHERE a.tableid = 0;
-- Repeat for tableid 1~9 with corresponding shard table
```

**Useful fields for migration logic (not stored as columns):**

| Field | Table | Notes |
|-------|-------|-------|
| `remote` | `_N` shard | `0`=local filesystem, `1`/`2`=remote storage. Determines how to resolve file path |
| `sha1` | `_N` shard | char(40). Use for dedup before uploading to R2 |
| `description` | `_N` shard | Attachment description text |

**File storage:** DZ stores local files in `data/attachment/forum/`. The `attachment` field contains the relative path (e.g., `202301/01/12345_abc.jpg`). Migrate to Cloudflare R2, store the R2 object key in `file_path`.

**Thumbnail files:** When `thumb = 1`, a thumbnail exists at the same path with `forum.php?mod=attachment` serving it. The physical file is typically at `{path}.thumb.jpg`.

---

## Data Volume (tongji.nocoo.cloud)

| Table | Rows | Data Size | Compressed Dump |
|-------|------|-----------|-----------------|
| `uc_members` | 1,140,438 | 551 MB | 66 MB |
| `pre_common_member` | 70,853 | 31 MB | (in main_small) |
| `pre_common_member_count` | 70,860 | 7 MB | (in main_small) |
| `pre_forum_forum` + `forumfield` | ~213 | < 1 MB | (in main_small) |
| `pre_forum_thread` | 790,115 | 984 MB | 44 MB |
| `pre_forum_post` (main) | 6,234,374 | 3,228 MB | 924 MB |
| `pre_forum_post_1~4` (shards) | 3,276,508 | 1,484 MB | 440 MB |
| `pre_forum_attachment` (index) | 78,178 | 5 MB | (in main_small) |
| `pre_forum_attachment_0~9` (shards) | ~76,721 | ~9 MB | (in main_small) |
| **Total** | **~11.7M rows** | **~6.3 GB** | **~1.4 GB** |

Note: `uc_members` has 1.14M records but `pre_common_member` only has 70K — the discrepancy is due to archived/purged members. `pre_common_member_archive` holds 1.07M archived records.

## D1 Capacity Planning

### Actual data measurement (tongji.nocoo.cloud, visible content only)

| D1 Table | Rows | Content Size | Est. D1 Size (with indexes) |
|----------|------|-------------|---------------------------|
| posts | 9,376,041 | 3,480 MB | ~4,500 MB |
| threads | 790,115 | 170 MB | ~350 MB |
| users | 70,853 | 14 MB | ~25 MB |
| attachments | 78,178 | 22 MB | ~35 MB |
| forums | 213 | < 1 MB | < 1 MB |
| **Total** | **~10.3M** | **~3,700 MB** | **~5,000 MB** |

### D1 limits (Workers Paid plan)

| Limit | Value | Status |
|-------|-------|--------|
| Database size | **10 GB** (hard cap, cannot increase) | ~5 GB used → ✅ 50% headroom |
| Databases per account | 50,000 | 1 used |
| Account storage | 1 TB | ~5 GB used |
| Max query duration | 30 seconds | |
| Max row size | 2 MB | Largest post ~50 KB → ✅ |
| Max bound params | 100 per query | |
| Max SQL length | 100 KB | |
| LIKE/GLOB pattern | 50 bytes max | ⚠️ limits search |
| Concurrency | Single-threaded per database | ⚠️ see write optimization |

**Single database is viable.** If future growth pushes toward 8 GB, split `posts` into a separate D1 database by date range (hot/cold). The 50,000 databases/account limit provides ample room for horizontal scaling.

> Note: the 6.3 GB "Data Size" in the DZ source tables above is MySQL InnoDB overhead. Actual content is ~3.7 GB. SQLite (D1) stores data more compactly.

---

## Performance

### Query patterns and index coverage

Every common page type must hit an index. Full table scans on 9.4M posts = 30s timeout + massive row-read billing.

| Page | Query Pattern | Index Used | Rows Scanned |
|------|--------------|------------|-------------|
| **Forum list** | `SELECT * FROM forums` | Full scan (213 rows — OK) | 213 |
| **Thread list** | `WHERE forum_id = ? ORDER BY sticky DESC, last_post_at DESC LIMIT 20` | `idx_threads_forum` ✅ | ~20 |
| **Thread view** | `WHERE thread_id = ? ORDER BY position LIMIT 20` | `idx_posts_thread` ✅ | ~20 |
| **User profile** | `WHERE author_id = ? ORDER BY created_at DESC LIMIT 20` | `idx_threads_author` / `idx_posts_author` ✅ | ~20 |
| **Homepage** | `ORDER BY last_post_at DESC LIMIT 20` | `idx_threads_latest` ✅ | ~20 |
| **Digest list** | `WHERE digest > 0 ORDER BY last_post_at DESC LIMIT 20` | `idx_threads_digest` ✅ (partial) | ~20 |
| **Attachment resolve** | `WHERE id = ?` | PK | 1 |
| **Post attachments** | `WHERE post_id IN (...)` | `idx_attachments_post` ✅ | ~1-10 |

### Complete index inventory

```sql
-- threads (790K rows, ~350 MB with indexes)
CREATE INDEX idx_threads_forum  ON threads(forum_id, sticky DESC, last_post_at DESC);  -- thread listing
CREATE INDEX idx_threads_author ON threads(author_id, created_at DESC);                -- user profile
CREATE INDEX idx_threads_latest ON threads(last_post_at DESC);                         -- homepage
CREATE INDEX idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0; -- digest listing

-- posts (9.4M rows, ~4.5 GB with indexes)
CREATE INDEX idx_posts_thread ON posts(thread_id, position);          -- thread view
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);   -- user profile

-- attachments (78K rows, ~35 MB with indexes)
CREATE INDEX idx_attachments_post   ON attachments(post_id);    -- post rendering
CREATE INDEX idx_attachments_thread ON attachments(thread_id);  -- thread attachments

-- users: UNIQUE(username) in CREATE TABLE already acts as an index
```

### Pagination: keyset, not OFFSET

D1 (SQLite) scans OFFSET rows before returning results. `OFFSET 50000` on 9.4M posts is catastrophic. Use keyset (cursor) pagination everywhere:

```sql
-- Thread listing: cursor = (last_sticky, last_post_at) from previous page
SELECT id, author_name, subject, created_at, last_post_at, last_poster,
       replies, views, sticky, digest
FROM threads
WHERE forum_id = ?
  AND (sticky < :last_sticky
       OR (sticky = :last_sticky AND last_post_at < :last_post_at))
ORDER BY sticky DESC, last_post_at DESC
LIMIT 20;

-- Post listing: cursor = last position
SELECT id, author_id, author_name, content, created_at, is_first, position
FROM posts
WHERE thread_id = ? AND position > :last_position
ORDER BY position
LIMIT 20;

-- User's threads: cursor = last created_at
SELECT id, forum_id, subject, created_at, replies, views
FROM threads
WHERE author_id = ? AND created_at < :last_created_at
ORDER BY created_at DESC
LIMIT 20;
```

### Caching architecture

```
Request → Cloudflare Worker (Smart Placement enabled)
  │
  ├─ Cache API (edge, per-PoP)
  │   ├─ Forum list ────────── TTL 5 min, invalidate on admin change
  │   ├─ Thread list pages ─── TTL 1 min, invalidate on new thread/reply
  │   └─ Thread view pages ─── TTL 1 min, invalidate on new reply
  │
  ├─ Workers KV (global, eventually consistent)
  │   ├─ Homepage hot threads ─ TTL 30-60s
  │   ├─ User sessions ──────── TTL 24h
  │   └─ Forum metadata ─────── TTL 5 min
  │
  ├─ D1 (single database, read replication enabled)
  │   ├─ Sessions API: "first-unconstrained" for reads (hit nearest replica)
  │   └─ Sessions API: "first-primary" for post-write reads (consistency)
  │
  ├─ R2 (object storage)
  │   ├─ Attachments (forum files)
  │   └─ Avatars (user profile images)
  │
  └─ Queues (async write buffer)
      ├─ View count batching ── aggregate, flush to D1 every N seconds
      └─ Search index updates ─ rebuild embeddings on new content
```

**Why each layer:**

| Layer | Latency | Use Case |
|-------|---------|----------|
| Cache API | <1 ms (edge hit) | Identical page requests within TTL window |
| KV | ~10 ms (global) | Cross-page shared data (sessions, hot content) |
| D1 replica | ~5-50 ms | SQL queries when cache miss, nearest region |
| D1 primary | ~20-100 ms | Writes and post-write reads |
| R2 | ~50-200 ms | Binary files (served via CDN for repeat access) |

### D1 read replication

Enable read replication for global latency reduction. D1 automatically replicates to all regions (ENAM, WNAM, WEUR, EEUR, APAC, OC).

```typescript
// Read-only pages (thread list, thread view, forum list)
const session = db.withSession("first-unconstrained");
const threads = await session.prepare("SELECT ...").all();

// After writing (user just posted a reply, needs to see it)
const session = db.withSession("first-primary");
const posts = await session.prepare("SELECT ...").all();
```

### Write optimization

D1 is **single-threaded** — one write at a time per database. Strategies to avoid bottleneck:

| Problem | Solution |
|---------|----------|
| **View count storms** | Don't `UPDATE threads SET views = views + 1` per request. Batch in KV or Durable Object, flush to D1 every 30-60s |
| **Burst posting** | Write through Cloudflare Queue. Worker enqueues, consumer batch-inserts to D1 |
| **Forum/thread counters** | Update asynchronously after post creation (via Queue consumer) |
| **Index write amplification** | Each index adds a write per INSERT. 6 indexes on posts = 7 writes per post. Acceptable at forum scale |

### Search strategy

D1 has no practical full-text search for Chinese content. `LIKE '%关键词%'` = full scan on 9.4M rows → timeout.

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Workers AI + Vectorize** | Semantic search, multilingual, no tokenizer issue | Requires embedding pipeline, async index | ✅ Phase 2 |
| **FTS5** | Built into D1, SQL-native | No Chinese tokenizer, adds ~1-2 GB to DB, virtual tables can't be exported | ❌ Skip |
| **External (Algolia/Meilisearch)** | Best search UX, CJK support | Extra service, cost | Consider if AI search insufficient |
| **Prefix search on subject** | Simple `WHERE subject LIKE 'keyword%'` with index | Only matches from start, useless for Chinese | ❌ Skip |

Recommend: defer search to Phase 2. Start with thread subject + author name lookup (exact match via existing indexes). Add Workers AI embeddings later for semantic search.
