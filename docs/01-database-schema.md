# Database Schema

Cloudflare D1 schema for Ellie, mapped from Discuz! X3.4.

## Overview

Discuz X3.4 has 200+ tables. Ellie only migrates the core forum data:

| Ellie Table | Discuz Source | Purpose |
|-------------|---------------|---------|
| `users` | `pre_ucenter_members` + `pre_common_member` | User accounts |
| `forums` | `pre_forum_forum` + `pre_forum_forumfield` | Forum categories and boards |
| `threads` | `pre_forum_thread` | Thread (topic) metadata |
| `posts` | `pre_forum_post` | Post content (first post + replies) |
| `attachments` | `pre_forum_attachment` + `pre_forum_attachment_0~9` | File attachments |

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
  reg_date      INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0
);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Notes |
|-------|-------------|--------------|-------|
| `id` | `pre_common_member` | `uid` | |
| `username` | `pre_ucenter_members` | `username` | |
| `email` | `pre_ucenter_members` | `email` | |
| `password_hash` | `pre_ucenter_members` | `password` | `md5(md5(password) + salt)` |
| `password_salt` | `pre_ucenter_members` | `salt` | 6-char random string |
| `avatar` | — | Computed from `uid` | `data/avatar/{uid%16}/{uid%256}/{uid}_avatar_big.jpg` |
| `reg_date` | `pre_common_member` | `regdate` | Unix timestamp |
| `threads` | `pre_common_member` | `threads` | |
| `posts` | `pre_common_member` | `posts` | |
| `credits` | `pre_common_member` | `credits` | |

**Password verification (legacy):**

```
stored_hash == md5(md5(user_input) + stored_salt)
```

On successful login, silently upgrade to argon2id and clear `password_salt`.

---

### forums

```sql
CREATE TABLE forums (
  id            INTEGER PRIMARY KEY,  -- DZ fid
  parent_id     INTEGER NOT NULL DEFAULT 0,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  type          TEXT    NOT NULL DEFAULT 'forum'
);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Notes |
|-------|-------------|--------------|-------|
| `id` | `pre_forum_forum` | `fid` | |
| `parent_id` | `pre_forum_forum` | `fup` | `0` = top-level category |
| `name` | `pre_forum_forum` | `name` | |
| `description` | `pre_forum_forumfield` | `description` | Separate table, join on `fid` |
| `display_order` | `pre_forum_forum` | `displayorder` | |
| `threads` | `pre_forum_forum` | `threads` | |
| `posts` | `pre_forum_forum` | `posts` | |
| `type` | `pre_forum_forum` | `type` | `group` / `forum` / `sub` |

**Hierarchy:** `group` (category) → `forum` (board) → `sub` (sub-board). `parent_id` points to the parent `fid`.

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
  replies       INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  is_closed     INTEGER NOT NULL DEFAULT 0,
  is_sticky     INTEGER NOT NULL DEFAULT 0,
  is_digest     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_threads_forum ON threads(forum_id, is_sticky DESC, last_post_at DESC);
CREATE INDEX idx_threads_author ON threads(author_id);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Notes |
|-------|-------------|--------------|-------|
| `id` | `pre_forum_thread` | `tid` | |
| `forum_id` | `pre_forum_thread` | `fid` | |
| `author_id` | `pre_forum_thread` | `authorid` | |
| `author_name` | `pre_forum_thread` | `author` | Denormalized username |
| `subject` | `pre_forum_thread` | `subject` | |
| `created_at` | `pre_forum_thread` | `dateline` | Unix timestamp |
| `last_post_at` | `pre_forum_thread` | `lastpost` | Unix timestamp |
| `replies` | `pre_forum_thread` | `replies` | |
| `views` | `pre_forum_thread` | `views` | |
| `is_closed` | `pre_forum_thread` | `closed` | `0` / `1` |
| `is_sticky` | `pre_forum_thread` | `displayorder` | DZ: `0`=normal, `1`=sticky, `2`=global sticky |
| `is_digest` | `pre_forum_thread` | `digest` | DZ: `0`=no, `1~3`=digest level |

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
CREATE INDEX idx_posts_author ON posts(author_id);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Notes |
|-------|-------------|--------------|-------|
| `id` | `pre_forum_post` | `pid` | |
| `thread_id` | `pre_forum_post` | `tid` | |
| `forum_id` | `pre_forum_post` | `fid` | |
| `author_id` | `pre_forum_post` | `authorid` | |
| `author_name` | `pre_forum_post` | `author` | |
| `content` | `pre_forum_post` | `message` | ⚠️ BBCode → HTML conversion needed |
| `created_at` | `pre_forum_post` | `dateline` | Unix timestamp |
| `is_first` | `pre_forum_post` | `first` | `1`=thread opener, `0`=reply |
| `position` | `pre_forum_post` | `position` | Floor number (1-based) |

**Content format:**

DZ stores BBCode in `message`. Migration must convert to HTML:

| BBCode | HTML |
|--------|------|
| `[b]text[/b]` | `<strong>text</strong>` |
| `[i]text[/i]` | `<em>text</em>` |
| `[url=href]text[/url]` | `<a href="href">text</a>` |
| `[img]src[/img]` | `<img src="src">` |
| `[quote]text[/quote]` | `<blockquote>text</blockquote>` |
| `[code]text[/code]` | `<pre><code>text</code></pre>` |
| `[color=red]text[/color]` | `<span style="color:red">text</span>` |
| `[size=4]text[/size]` | `<span style="font-size:...">text</span>` |
| `[attach]aid[/attach]` | Resolve to attachment URL |

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
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_attachments_post ON attachments(post_id);
```

**Field mapping:**

| Field | Discuz Table | Discuz Field | Notes |
|-------|-------------|--------------|-------|
| `id` | `pre_forum_attachment_N` | `aid` | N = `tid % 10` (sharded table) |
| `thread_id` | `pre_forum_attachment_N` | `tid` | |
| `post_id` | `pre_forum_attachment_N` | `pid` | |
| `author_id` | `pre_forum_attachment_N` | `uid` | |
| `filename` | `pre_forum_attachment_N` | `filename` | Original upload name |
| `file_path` | `pre_forum_attachment_N` | `attachment` | DZ relative path → R2 key |
| `file_size` | `pre_forum_attachment_N` | `filesize` | Bytes |
| `is_image` | `pre_forum_attachment_N` | `isimage` | `-1`=no, `1`=yes in DZ |
| `downloads` | `pre_forum_attachment_N` | `downloads` | |
| `created_at` | `pre_forum_attachment_N` | `dateline` | Unix timestamp |

**DZ attachment sharding:** `pre_forum_attachment` is the index table. Actual file metadata is in `pre_forum_attachment_0` through `pre_forum_attachment_9`, determined by `tid % 10`. Migration must query all 10 tables.

**File storage:** DZ stores files in `data/attachment/forum/`. Migrate to Cloudflare R2, store the R2 object key in `file_path`.

---

## D1 Constraints

| Limit | Value | Mitigation |
|-------|-------|------------|
| Database size | 10 GB (free) / 50 GB (paid) | Text-only forum data is typically < 1 GB |
| Query result | 5 MB / 1000 rows max | Paginate all list queries |
| Full-text search | Not supported | Use Workers AI or external search |
| Write throughput | Limited | Acceptable for low-traffic archive + basic interaction |