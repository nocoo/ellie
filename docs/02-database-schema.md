# 数据库设计

Ellie 的 Cloudflare D1 数据库 schema，从 Discuz! X3.4 映射而来。

数据源：`tongji.nocoo.cloud` — MySQL 8.0.42，数据库 `db_tongji_main` 和 `db_tongji_ucenter`。

## 概述

Discuz X3.4 有 200+ 张表。Ellie 只迁移核心论坛数据：

| Ellie Table | Discuz Source | Purpose |
|-------------|---------------|---------|
| `users` | `uc_members` + `pre_common_member` + `pre_common_member_count` | 用户账号 |
| `forums` | `pre_forum_forum` + `pre_forum_forumfield` | 论坛分区和版块 |
| `threads` | `pre_forum_thread` | 帖子（主题）元数据 |
| `posts` | `pre_forum_post` + `pre_forum_post_1~4` | 帖子内容（首帖 + 回复） |
| `attachments` | `pre_forum_attachment`（索引表）+ `pre_forum_attachment_0~9`（分片表） | 文件附件 |

> 所有 DZ 表的完整 schema 见 `reference/db/schema_all.sql.gz`，仅供参考。

### 数据库布局

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
  status        INTEGER NOT NULL DEFAULT 0,   -- 0=normal, -1=banned, -2=archived
  role          INTEGER NOT NULL DEFAULT 0,   -- 0=user, 1=admin, 2=super-mod, 3=mod
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0
);
```

**字段映射：**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_common_member` | `uid` | mediumint unsigned PK | 同时也是 `uc_members` 的 PK（共享 uid 空间） |
| `username` | `uc_members` | `username` | char(15) | 位于 `db_tongji_ucenter`。`pre_common_member` 也有 `username` |
| `email` | `uc_members` | `email` | char(32) | `pre_common_member.email` 是 char(40)，优先使用 ucenter 作为认证源 |
| `password_hash` | `uc_members` | `password` | char(32) | `md5(md5(password) + salt)` — 详见下方 |
| `password_salt` | `uc_members` | `salt` | char(6) | 6 位随机字符串 |
| `avatar` | — | 由 `uid` 计算 | — | R2 key: `avatars/{uid}.jpg`（源路径 `data/avatar/{uid%16}/{uid%256}/{uid}_avatar_big.jpg`） |
| `status` | `pre_common_member` | `status` | tinyint(1) | `0`=正常，`-1`=封禁，`-2`=归档。见下方迁移策略 |
| `role` | `pre_common_member` | `adminid` | tinyint(1) | `0`=用户，`1`=管理员，`2`=超级版主，`3`=版主 |
| `reg_date` | `pre_common_member` | `regdate` | int unsigned | Unix 时间戳 |
| `last_login` | `uc_members` | `lastlogintime` | int unsigned | Unix 时间戳 |
| `threads` | `pre_common_member_count` | `threads` | mediumint unsigned | ⚠️ 不在 `pre_common_member` 中 — 独立表，通过 `uid` 关联 |
| `posts` | `pre_common_member_count` | `posts` | mediumint unsigned | ⚠️ 不在 `pre_common_member` 中 — 独立表，通过 `uid` 关联 |
| `credits` | `pre_common_member` | `credits` | int | |

**迁移查询（全量——以 `uc_members` 为基准）：**

```sql
-- Step 1: 活跃用户（pre_common_member 中存在的 ~7万）
SELECT
  m.uid, uc.username, uc.email, uc.password, uc.salt,
  m.status, m.adminid, m.regdate, m.avatarstatus,
  uc.lastlogintime,
  COALESCE(mc.threads, 0) AS threads,
  COALESCE(mc.posts, 0) AS posts,
  m.credits
FROM db_tongji_main.pre_common_member m
JOIN db_tongji_ucenter.uc_members uc ON uc.uid = m.uid
LEFT JOIN db_tongji_main.pre_common_member_count mc ON mc.uid = m.uid;
-- status: m.status (0=normal, -1=banned), freeze → -1

-- Step 2: 归档用户（pre_common_member_archive 中存在的 ~107万）
SELECT
  a.uid, uc.username, uc.email, uc.password, uc.salt,
  -2 AS status,  -- 标记为归档
  0 AS adminid, a.regdate, 0 AS avatarstatus,
  uc.lastlogintime,
  0 AS threads, 0 AS posts, 0 AS credits
FROM db_tongji_main.pre_common_member_archive a
JOIN db_tongji_ucenter.uc_members uc ON uc.uid = a.uid
WHERE a.uid NOT IN (SELECT uid FROM db_tongji_main.pre_common_member);
-- 排除已在 Step 1 中迁移的用户
```

> **决策：全量迁移。** `uc_members` 有 114 万条记录，`pre_common_member` 只有 7 万条，差异的 107 万在 `pre_common_member_archive` 中（DZ 自动归档长期不登录的用户）。这些归档用户的帖子仍在系统中，必须迁移以保证 FK 完整性。归档用户 `status = -2`，不开放登录但保留数据关联。

**辅助过滤字段（不作为列迁移，但在迁移过程中使用）：**

| Field | Table | Notes |
|-------|-------|-------|
| `avatarstatus` | `pre_common_member` | `0`=无头像，`1`=有头像 — 无头像的用户跳过头像迁移 |
| `freeze` | `pre_common_member` | `0`=正常，`1`=冻结 — 可过滤或标记 |
| `groupid` | `pre_common_member` | 用户组 ID — 在 DZ 中决定权限等级 |

**密码验证（旧版）：**

```
stored_hash == md5(md5(user_input) + stored_salt)
```

登录成功后，静默升级为 argon2id 并清除 `password_salt`。

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

**字段映射：**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_forum` | `fid` | mediumint unsigned PK | |
| `parent_id` | `pre_forum_forum` | `fup` | mediumint unsigned | `0` = 顶级分类 |
| `name` | `pre_forum_forum` | `name` | char(50) | |
| `description` | `pre_forum_forumfield` | `description` | text | 独立表，通过 `fid` 关联 |
| `icon` | `pre_forum_forumfield` | `icon` | varchar(255) | 版块图标路径 |
| `display_order` | `pre_forum_forum` | `displayorder` | smallint | |
| `threads` | `pre_forum_forum` | `threads` | mediumint unsigned | |
| `posts` | `pre_forum_forum` | `posts` | mediumint unsigned | |
| `type` | `pre_forum_forum` | `type` | enum('group','forum','sub') | `group`=分类，`forum`=版块，`sub`=子版块 |
| `status` | `pre_forum_forum` | `status` | tinyint(1) | `0`=隐藏，`1`=正常。过滤隐藏版块 |
| `last_thread_id` | `pre_forum_forum` | `lastpost` | char(110) | 从 `lastpost` 字段解析（格式：`tid\tsubject\ttimestamp\tposter`） |
| `last_post_at` | `pre_forum_forum` | `lastpost` | char(110) | `lastpost` 中的时间戳部分 |
| `last_poster` | `pre_forum_forum` | `lastpost` | char(110) | `lastpost` 中的发帖人部分 |

**层级结构：** `group`（分类）→ `forum`（版块）→ `sub`（子版块）。`parent_id` 指向父级 `fid`。

**迁移查询：**

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

**字段映射：**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_thread` | `tid` | mediumint unsigned PK | |
| `forum_id` | `pre_forum_thread` | `fid` | mediumint unsigned | |
| `author_id` | `pre_forum_thread` | `authorid` | mediumint unsigned | |
| `author_name` | `pre_forum_thread` | `author` | char(15) | 反范式化的用户名 |
| `subject` | `pre_forum_thread` | `subject` | char(80) | |
| `created_at` | `pre_forum_thread` | `dateline` | int unsigned | Unix 时间戳 |
| `last_post_at` | `pre_forum_thread` | `lastpost` | int unsigned | Unix 时间戳 |
| `last_poster` | `pre_forum_thread` | `lastposter` | char(15) | 最后回复者用户名 |
| `replies` | `pre_forum_thread` | `replies` | mediumint unsigned | |
| `views` | `pre_forum_thread` | `views` | int unsigned | |
| `closed` | `pre_forum_thread` | `closed` | mediumint unsigned | `0`=开放，`1`=关闭，`>1`=已合并到 tid=closed 的帖子 |
| `sticky` | `pre_forum_thread` | `displayorder` | tinyint(1) | `0`=普通，`1`=置顶，`2`=全局置顶，`3`=分类置顶 |
| `digest` | `pre_forum_thread` | `digest` | tinyint(1) | `0`=否，`1~3`=精华等级 |
| `special` | `pre_forum_thread` | `special` | tinyint(1) | `0`=普通，`1`=投票，`2`=交易，`3`=悬赏，`4`=活动，`5`=辩论 |
| `highlight` | `pre_forum_thread` | `highlight` | tinyint(1) | 标题样式编码（颜色/加粗/斜体） |
| `recommends` | `pre_forum_thread` | `recommends` | smallint | 净推荐数（recommend_add - recommend_sub） |
| `post_table_id` | `pre_forum_thread` | `posttableid` | smallint unsigned | ⚠️ 该主题的回复存储在哪个 `pre_forum_post_N` 分片中。`0` = 主表 |

**`closed` 字段的关键语义：**

```
closed == 0     → thread is open
closed == 1     → thread is closed (locked)
closed > 1      → thread was merged into thread with tid = closed
```

当 `closed > 1` 时，该主题实际上是一个重定向。**迁移时直接跳过**（见下方迁移决策）。

**帖子分片：** DZ 将帖子数据分布在 `pre_forum_post`（主表，posttableid=0）和 `pre_forum_post_1` 到 `pre_forum_post_4`（本实例）之间。`posttableid` 字段决定查询哪张表。迁移时必须读取所有帖子表。

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

**字段映射：**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_post[_N]` | `pid` | int unsigned | UNIQUE KEY（在 DZ 中不是 PK — DZ 的 PK 是 `(tid, position)`） |
| `thread_id` | `pre_forum_post[_N]` | `tid` | mediumint unsigned | |
| `forum_id` | `pre_forum_post[_N]` | `fid` | mediumint unsigned | |
| `author_id` | `pre_forum_post[_N]` | `authorid` | mediumint unsigned | |
| `author_name` | `pre_forum_post[_N]` | `author` | varchar(15) | |
| `content` | `pre_forum_post[_N]` | `message` | mediumtext | ⚠️ 需要进行 BBCode → HTML 转换 — 详见下方内容格式 |
| `created_at` | `pre_forum_post[_N]` | `dateline` | int unsigned | Unix 时间戳 |
| `is_first` | `pre_forum_post[_N]` | `first` | tinyint(1) | `1`=主题首帖，`0`=回复 |
| `position` | `pre_forum_post[_N]` | `position` | int unsigned | 楼层号（从 1 开始，AUTO_INCREMENT） |

**关键过滤字段（迁移时使用，不存储为列）：**

| Field | Type | Notes |
|-------|------|-------|
| `invisible` | tinyint(1) | `0`=可见，`-1`=待审核，`-5`=已忽略。**仅迁移 `invisible = 0` 的记录** |
| `htmlon` | tinyint(1) | `1`=该帖启用 HTML。如果开启，`message` 可能包含原始 HTML |
| `bbcodeoff` | tinyint(1) | `1`=BBCode 已禁用。如果开启，`message` 中的 `[tags]` 是纯文本而非 BBCode |

**帖子表数据分布（本实例）：**

| Table | Rows | posttableid |
|-------|------|-------------|
| `pre_forum_post`（主表） | 6,234,374 | `0` |
| `pre_forum_post_1` | 716,601 | `1` |
| `pre_forum_post_2` | 823,776 | `2` |
| `pre_forum_post_3` | 862,397 | `3` |
| `pre_forum_post_4` | 873,734 | `4` |
| **合计** | **9,510,882** | |

**迁移查询（每张表）：**

```sql
-- Repeat for each post table: pre_forum_post, pre_forum_post_1 ... pre_forum_post_4
SELECT pid, tid, fid, authorid, author, message, dateline, first, position,
       invisible, htmlon, bbcodeoff
FROM pre_forum_post
WHERE invisible = 0;
```

**内容格式：**

DZ 在 `message` 中存储 BBCode。转换前需检查每条帖子的标志位：
- 如果 `bbcodeoff = 1`：将 `message` 视为纯文本（不进行 BBCode 解析）
- 如果 `htmlon = 1`：`message` 可能包含原始 HTML 与 BBCode 混合的内容

BBCode → HTML 转换对照表：

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
| `[attach]aid[/attach]` | 通过 `attachments` 表解析为附件 URL |

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

**字段映射：**

| Field | Discuz Table | Discuz Field | Type | Notes |
|-------|-------------|--------------|------|-------|
| `id` | `pre_forum_attachment` | `aid` | mediumint unsigned PK | 来自**索引表** |
| `thread_id` | `pre_forum_attachment_N` | `tid` | mediumint unsigned | |
| `post_id` | `pre_forum_attachment_N` | `pid` | int unsigned | |
| `author_id` | `pre_forum_attachment_N` | `uid` | mediumint unsigned | |
| `filename` | `pre_forum_attachment_N` | `filename` | varchar(255) | 原始上传文件名 |
| `file_path` | `pre_forum_attachment_N` | `attachment` | varchar(255) | DZ 相对路径 → R2 key |
| `file_size` | `pre_forum_attachment_N` | `filesize` | int unsigned | 字节 |
| `is_image` | `pre_forum_attachment_N` | `isimage` | tinyint(1) | `0`=否，`1`=是（不是 -1/1） |
| `width` | `pre_forum_attachment_N` | `width` | smallint unsigned | 图片宽度（px），非图片为 `0` |
| `has_thumb` | `pre_forum_attachment_N` | `thumb` | tinyint unsigned | `0`=无缩略图，`1`=有缩略图 |
| `downloads` | `pre_forum_attachment` | `downloads` | mediumint | ⚠️ 在**索引表**上，不在分片表上 |
| `created_at` | `pre_forum_attachment_N` | `dateline` | int unsigned | Unix 时间戳 |

**附件分片架构：**

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

**分片查找：** 使用 `pre_forum_attachment.tableid` 确定查询哪张 `_N` 表。不要假设 `tid % 10` — 使用 `tableid` 字段。

**迁移查询：**

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

**迁移逻辑中使用的辅助字段（不存储为列）：**

| Field | Table | Notes |
|-------|-------|-------|
| `remote` | `_N` 分片 | `0`=本地文件系统，`1`/`2`=远程存储。决定文件路径的解析方式 |
| `sha1` | `_N` 分片 | char(40)。上传到 R2 前用于去重 |
| `description` | `_N` 分片 | 附件描述文本 |

**文件存储：** DZ 将本地文件存储在 `data/attachment/forum/` 下。`attachment` 字段包含相对路径（如 `202301/01/12345_abc.jpg`）。迁移到 Cloudflare R2 后，将 R2 对象 key 存储在 `file_path` 中。

**缩略图文件：** 当 `thumb = 1` 时，缩略图存在于相同路径，通过 `forum.php?mod=attachment` 提供服务。物理文件通常位于 `{path}.thumb.jpg`。

---

## 数据量（tongji.nocoo.cloud）

| Table | Rows | Data Size | Compressed Dump |
|-------|------|-----------|-----------------|
| `uc_members` | 1,140,438 | 551 MB | 66 MB |
| `pre_common_member` | 70,853 | 31 MB | （在 main_small 中） |
| `pre_common_member_count` | 70,860 | 7 MB | （在 main_small 中） |
| `pre_forum_forum` + `forumfield` | ~213 | < 1 MB | （在 main_small 中） |
| `pre_forum_thread` | 790,115 | 984 MB | 44 MB |
| `pre_forum_post`（主表） | 6,234,374 | 3,228 MB | 924 MB |
| `pre_forum_post_1~4`（分片表） | 3,276,508 | 1,484 MB | 440 MB |
| `pre_forum_attachment`（索引表） | 78,178 | 5 MB | （在 main_small 中） |
| `pre_forum_attachment_0~9`（分片表） | ~76,721 | ~9 MB | （在 main_small 中） |
| **合计** | **~11.7M 行** | **~6.3 GB** | **~1.4 GB** |

注意：`uc_members` 有 114 万条记录，`pre_common_member` 只有 7 万条。差异来自 `pre_common_member_archive` 中的 107 万条归档记录（长期不登录被 DZ 自动归档）。**全量迁移 114 万用户**，归档用户标记 `status = -2`。

## D1 容量规划

### 实际数据测量（tongji.nocoo.cloud，仅可见内容）

| D1 Table | Rows | Content Size | Est. D1 Size (with indexes) |
|----------|------|-------------|---------------------------|
| posts | 9,376,041 | 3,480 MB | ~4,500 MB |
| threads | 790,115 | 170 MB | ~350 MB |
| users | 1,140,438 | ~230 MB | ~280 MB |
| attachments | 78,178 | 22 MB | ~35 MB |
| forums | 213 | < 1 MB | < 1 MB |
| **合计** | **~11.4M** | **~3,900 MB** | **~5,200 MB** |

### D1 限制（Workers Paid 计划）

| Limit | Value | Status |
|-------|-------|--------|
| 数据库大小 | **10 GB**（硬上限，无法提升） | ~5.2 GB 已用 → ✅ 48% 余量 |
| 每账号数据库数 | 50,000 | 已用 1 个 |
| 账号存储总量 | 1 TB | ~5 GB 已用 |
| 最大查询时长 | 30 秒 | |
| 最大行大小 | 2 MB | 最大帖子 ~50 KB → ✅ |
| 最大绑定参数数 | 每次查询 100 个 | |
| 最大 SQL 长度 | 100 KB | |
| LIKE/GLOB 模式 | 最长 50 字节 | ⚠️ 限制搜索能力 |
| 并发 | 每个数据库单线程 | ⚠️ 参见写入优化 |

**单数据库方案可行。** 如果未来增长推进到 8 GB，可按日期范围（热/冷数据）将 `posts` 拆分到独立的 D1 数据库。每账号 50,000 个数据库的限制为水平扩展提供了充足空间。

> 注意：上面 DZ 源表中 6.3 GB 的"Data Size"包含 MySQL InnoDB 开销。实际内容约 3.7 GB。SQLite（D1）存储数据更紧凑。

---

## 性能

### 查询模式与索引覆盖

每种常见页面类型都必须命中索引。对 940 万条帖子进行全表扫描会导致 30 秒超时 + 大量行读取计费。

| Page | Query Pattern | Index Used | Rows Scanned | Target Latency |
|------|--------------|------------|-------------|----------------|
| **版块列表** | `SELECT * FROM forums` | 全表扫描（213 行 — 可接受） | 213 | <5 ms |
| **帖子列表** | `WHERE forum_id = ? ORDER BY sticky DESC, last_post_at DESC LIMIT 20` | `idx_threads_forum` ✅ | ~20 | <10 ms |
| **帖子详情** | `WHERE thread_id = ? ORDER BY position LIMIT 20` | `idx_posts_thread` ✅ | ~20 | <10 ms |
| **用户主页** | `WHERE author_id = ? ORDER BY created_at DESC LIMIT 20` | `idx_threads_author` / `idx_posts_author` ✅ | ~20 | <10 ms |
| **首页** | `ORDER BY last_post_at DESC LIMIT 20` | `idx_threads_latest` ✅ | ~20 | <10 ms |
| **精华列表** | `WHERE digest > 0 ORDER BY last_post_at DESC LIMIT 20` | `idx_threads_digest` ✅（部分索引） | ~20 | <10 ms |
| **附件解析** | `WHERE id = ?` | PK | 1 | <5 ms |
| **帖子附件** | `WHERE post_id IN (...)` | `idx_attachments_post` ✅ | ~1-10 | <5 ms |

> **性能分层：** 上表为 D1 primary 的裸查询延迟目标。加上网络后，通过 D1 read replica 的 Worker 响应时间：索引命中查询 <50 ms，Cache API 命中 <5 ms。深翻页（keyset 定位到远端数据）允许 <100 ms。

### 完整索引清单

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

### 分页：使用 keyset，而非 OFFSET

D1（SQLite）在返回结果前会扫描 OFFSET 行。对 940 万条帖子执行 `OFFSET 50000` 是灾难性的。所有地方都使用 keyset（游标）分页：

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

### 缓存架构

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

**各层用途说明：**

| Layer | Latency | Use Case |
|-------|---------|----------|
| Cache API | <1 ms（边缘命中） | TTL 窗口内的相同页面请求 |
| KV | ~10 ms（全球） | 跨页面共享数据（会话、热门内容） |
| D1 replica | ~5-50 ms | 缓存未命中时的 SQL 查询，就近区域 |
| D1 primary | ~20-100 ms | 写入和写后读 |
| R2 | ~50-200 ms | 二进制文件（通过 CDN 缓存重复访问） |

### D1 读副本

启用读副本以降低全球延迟。D1 自动复制到所有区域（ENAM、WNAM、WEUR、EEUR、APAC、OC）。

```typescript
// Read-only pages (thread list, thread view, forum list)
const session = db.withSession("first-unconstrained");
const threads = await session.prepare("SELECT ...").all();

// After writing (user just posted a reply, needs to see it)
const session = db.withSession("first-primary");
const posts = await session.prepare("SELECT ...").all();
```

### 写入优化

D1 是**单线程**的 — 每个数据库同一时间只能处理一个写入。避免瓶颈的策略：

| Problem | Solution |
|---------|----------|
| **浏览量风暴** | 不要每次请求都执行 `UPDATE threads SET views = views + 1`。在 KV 或 Durable Object 中批量聚合，每 30-60 秒刷入 D1 |
| **突发发帖** | 通过 Cloudflare Queue 写入。Worker 入队，消费者批量插入 D1 |
| **版块/帖子计数器** | 在帖子创建后异步更新（通过 Queue 消费者） |
| **索引写放大** | 每个索引增加一次写入。posts 上 2 个索引 = 每条帖子 3 次写入（数据页 + 2 个索引页）。整体 8 个索引在论坛写入规模下可接受 |

### 搜索策略

D1 对中文内容没有实用的全文搜索能力。`LIKE '%关键词%'` = 对 940 万行全表扫描 → 超时。

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Workers AI + Vectorize** | 语义搜索，多语言，无分词问题 | 需要 embedding 流水线，异步索引 | ✅ 第二阶段 |
| **FTS5** | D1 内置，SQL 原生 | 无中文分词器，增加 ~1-2 GB 数据库体积，虚拟表无法导出 | ❌ 跳过 |
| **外部服务（Algolia/Meilisearch）** | 最佳搜索体验，CJK 支持 | 额外服务，有成本 | AI 搜索不足时考虑 |
| **前缀搜索 subject** | 简单的 `WHERE subject LIKE 'keyword%'` 可用索引 | 只能匹配开头，对中文无用 | ❌ 跳过 |

建议：搜索功能推迟到第二阶段。先实现帖子标题 + 作者名查找（通过现有索引精确匹配）。后续添加 Workers AI embedding 实现语义搜索。

---

## 迁移决策

在 schema 设计和迁移过程中做出的关键决策，统一记录于此。

### 归档用户

**决策：全量迁移 114 万用户。**

- `uc_members` 114 万 → `pre_common_member` 7 万（活跃）+ `pre_common_member_archive` 107 万（归档）
- 归档用户是被 Discuz 自动归档的长期不登录用户，**不是**封禁用户
- 这些用户的帖子仍然存在于 `pre_forum_post` 中，`authorid` 指向其 uid
- 不迁移会导致帖子 FK 悬空（orphan）→ 无法通过完整性验证
- `status` 字段区分：`0`=正常，`-1`=封禁/冻结，`-2`=归档
- 归档用户不开放登录（前端检查 `status < 0`），但保留数据关联和公开可见的历史帖子

### 封禁/冻结用户

**决策：迁移，标记 `status = -1`。**

- `pre_common_member` 中 `status = -1` 或 `freeze = 1` 的用户一并迁移
- 不排除，因为他们的帖子可能仍是可见的（`invisible = 0`）
- 前端/API 层根据 `status` 控制登录和互动权限

### 合并帖子

**决策：跳过 `closed > 1` 的 thread 记录。**

- 当 `closed > 1` 时，`closed` 的值是目标 thread 的 tid（重定向）
- 这些帖子的内容已经合并到目标 thread 中，只剩一个壳
- 迁移时直接跳过，不创建重定向记录
- 如果未来需要 URL 兼容（旧链接 `tid=xxx` 跳转），在 Worker 层用 KV 存一份 tid→target_tid 映射即可

### 匿名/已删除作者

**决策：保留反范式化 `author_name` 字段。**

- DZ 在 `pre_forum_thread` 和 `pre_forum_post` 中同时存了 `authorid` 和 `author`（用户名）
- 即使 `authorid` 指向的用户被删除或不存在，`author_name` 仍然可以展示
- D1 schema 中的 FK 约束是逻辑约束（SQLite 默认不强制），不会因缺失用户导致写入失败
- 但迁移验证仍然要求 0 orphan — 全量迁移用户后，所有帖子的 `author_id` 应该都能关联到 `users.id`
