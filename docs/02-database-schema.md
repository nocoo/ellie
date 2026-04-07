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
  status        INTEGER NOT NULL DEFAULT 0,   -- 0=normal, -1=banned, -2=archived, -3=placeholder
  role          INTEGER NOT NULL DEFAULT 0,   -- 0=user, 1=admin, 2=super-mod, 3=mod (actual data also has -1, 7)
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0,
  -- Extended profile fields (added post-migration)
  signature     TEXT    NOT NULL DEFAULT '',  -- User signature (DZ sightml)
  group_title   TEXT    NOT NULL DEFAULT '',  -- User group display name
  group_stars   INTEGER NOT NULL DEFAULT 0,   -- Star count for user group
  group_color   TEXT    NOT NULL DEFAULT '',  -- User group color (hex)
  custom_title  TEXT    NOT NULL DEFAULT '',  -- Custom user title
  digest_posts  INTEGER NOT NULL DEFAULT 0,   -- Digest post count
  ol_time       INTEGER NOT NULL DEFAULT 0,   -- Online time (seconds)
  gender        INTEGER NOT NULL DEFAULT 0,   -- 0=unknown, 1=male, 2=female
  birth_year    INTEGER NOT NULL DEFAULT 0,
  birth_month   INTEGER NOT NULL DEFAULT 0,
  birth_day     INTEGER NOT NULL DEFAULT 0,
  reside_province TEXT  NOT NULL DEFAULT '',
  reside_city   TEXT    NOT NULL DEFAULT '',
  graduate_school TEXT  NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',  -- User biography
  interest      TEXT    NOT NULL DEFAULT '',  -- User interests
  qq            TEXT    NOT NULL DEFAULT '',  -- QQ number
  site          TEXT    NOT NULL DEFAULT '',  -- Personal website
  last_activity INTEGER NOT NULL DEFAULT 0,   -- Last activity timestamp
  reg_ip        TEXT    NOT NULL DEFAULT '',  -- Registration IP
  last_ip       TEXT    NOT NULL DEFAULT ''   -- Last login IP
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
| `status` | `pre_common_member` | `status` | tinyint(1) | `0`=正常，`-1`=封禁，`-2`=归档，`-3`=占位（迁移中 FK 断裂时自动创建）。见下方迁移策略 |
| `role` | `pre_common_member` | `adminid` | tinyint(1) | `0`=用户，`1`=管理员，`2`=超级版主，`3`=版主。实际数据还包含 `-1` 和 `7`（DZ 扩展角色） |
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
>
> **⚠️ 实际迁移发现：** dump 中 `pre_common_member_archive` 和 `pre_common_member_count` 均为 0 条记录。所有 114 万用户均来自 `uc_members`，其中 7 万能匹配到 `pre_common_member`（获得 status/role/avatar 等数据），剩余 ~107 万用户缺少 member 数据（status/role/threads/posts 等均为默认值 0）。

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
  status          INTEGER NOT NULL DEFAULT 1,   -- 0=hidden, 1=normal, 3=group, -1=placeholder
  last_thread_id  INTEGER NOT NULL DEFAULT 0,
  last_post_at    INTEGER NOT NULL DEFAULT 0,
  last_poster     TEXT    NOT NULL DEFAULT '',
  -- Extended fields (added post-migration)
  last_thread_subject TEXT NOT NULL DEFAULT '',  -- Last thread's subject for display
  moderators      TEXT    NOT NULL DEFAULT '',   -- Tab-separated moderator usernames (DZ format)
  last_poster_id  INTEGER NOT NULL DEFAULT 0,    -- Last poster user ID for profile link
  moderator_ids   TEXT    NOT NULL DEFAULT '',   -- Comma-separated moderator user IDs
  visibility      TEXT    NOT NULL DEFAULT 'public'
    CHECK(visibility IN ('public', 'members', 'staff', 'admin'))  -- Access control
);

CREATE INDEX idx_forums_last_poster_id ON forums(last_poster_id);
CREATE INDEX idx_forums_visibility ON forums(visibility);
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
| `status` | `pre_forum_forum` | `status` | tinyint(1) | `0`=隐藏，`1`=正常，`3`=群组，`-1`=占位（迁移中 FK 断裂时自动创建）。**全量迁移，不过滤** |
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
LEFT JOIN pre_forum_forumfield ff ON ff.fid = f.fid;
-- 全量迁移，不过滤 status。Parse f.lastpost in application code to extract last_thread_id, last_post_at, last_poster
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
  sticky        INTEGER NOT NULL DEFAULT 0,   -- <0=hidden, 0=normal, 1+=pinned, -99=placeholder
  digest        INTEGER NOT NULL DEFAULT 0,
  special       INTEGER NOT NULL DEFAULT 0,
  highlight     INTEGER NOT NULL DEFAULT 0,
  recommends    INTEGER NOT NULL DEFAULT 0,
  post_table_id INTEGER NOT NULL DEFAULT 0,
  -- Extended fields (added post-migration)
  type_name     TEXT    NOT NULL DEFAULT '',   -- Thread type classification
  last_poster_id INTEGER NOT NULL DEFAULT 0    -- Last poster user ID for profile link
);

CREATE INDEX idx_threads_forum ON threads(forum_id, sticky DESC, last_post_at DESC);
CREATE INDEX idx_threads_author ON threads(author_id, created_at DESC);
CREATE INDEX idx_threads_latest ON threads(last_post_at DESC);
CREATE INDEX idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0;
CREATE INDEX idx_threads_last_poster_id ON threads(last_poster_id);
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
| `sticky` | `pre_forum_thread` | `displayorder` | tinyint(1) | 负值=隐藏，`0`=普通，`1`=置顶，`2`=全局置顶，`3`=分类置顶，`-99`=占位（迁移中 FK 断裂时自动创建） |
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

当 `closed > 1` 时，该主题实际上是一个重定向。**迁移时完整保留**，应用层根据 `closed` 值做 redirect 处理。

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
  position      INTEGER NOT NULL DEFAULT 0,
  invisible     INTEGER NOT NULL DEFAULT 0    -- 0=visible, -1=deleted, -5=ignored, 1=pending review
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
| `invisible` | `pre_forum_post[_N]` | `invisible` | tinyint(1) | `0`=可见，`1`=待审核，`-1`=已删除，`-5`=已忽略。**全量迁移，状态透传** |

**辅助标志位（迁移时使用，不存储为列）：**

| Field | Type | Notes |
|-------|------|-------|
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

> 实际迁移后含 14 条占位帖子（invisible=-1），posts 总计 9,510,896 行。

**迁移查询（每张表）：**

```sql
-- Repeat for each post table: pre_forum_post, pre_forum_post_1 ... pre_forum_post_4
SELECT pid, tid, fid, authorid, author, message, dateline, first, position,
       invisible, htmlon, bbcodeoff
FROM pre_forum_post;
-- 全量迁移，不过滤 invisible。invisible 值透传到 D1
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
| `[s]text[/s]` | `<s>text</s>` |
| `[url=href]text[/url]` | `<a href="href">text</a>` |
| `[img]src[/img]` | `<img src="src">` |
| `[quote]text[/quote]` | `<blockquote>text</blockquote>` |
| `[code]text[/code]` | `<pre><code>text</code></pre>` |
| `[color=red]text[/color]` | `<span style="color:red">text</span>` |
| `[size=4]text[/size]` | `<span style="font-size:...">text</span>` |
| `[align=center]text[/align]` | `<div style="text-align:center">text</div>` |
| `[hr]` | `<hr>` |
| `[attach]aid[/attach]` | `<attachment data-aid="aid"></attachment>` — 运行时由前端解析为 R2 附件 URL |
| `[list][*]item[/list]` | `<ul><li>item</ul>` |
| `[list=1][*]item[/list]` | `<ol><li>item</ol>` |

**⚠️ 尚未转换的 DZ 特有标签（存量数据中存在）：**

| BBCode | 说明 | 处理状态 |
|--------|------|---------|
| `[font=宋体]text[/font]` | 字体设置 | ❌ 保留原始 BBCode |
| `[backcolor=yellow]text[/backcolor]` | 背景色 | ❌ 保留原始 BBCode |
| `[table][tr][td]...[/td][/tr][/table]` | 表格 | ❌ 保留原始 BBCode |
| `[email]addr[/email]` | 邮件链接 | ❌ 保留原始 BBCode |
| `[p=30, 2, left]text[/p]` | DZ 段落格式 | ❌ 保留原始 BBCode |
| `[i=s]text[/i]` | DZ 特殊斜体 | ❌ 保留原始 BBCode |

> 这些标签在早期帖子（2002-2010 年）中较常见。未来可按需扩展 BBCode 转换器，或在前端渲染时处理剩余 BBCode 标签。

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
| `is_image` | `pre_forum_attachment_N` | `isimage` | tinyint(1) | `-1`=未知，`0`=否，`1`=是 |
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

## 管理功能表

以下表格用于论坛管理功能，非 Discuz 迁移数据，而是 Ellie 原生创建。

### ip_bans

IP 封禁管理。

```sql
CREATE TABLE ip_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,               -- IP address or CIDR range
  admin_id INTEGER NOT NULL,      -- Admin who created the ban
  admin_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,             -- NULL = permanent ban
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_ip_bans_ip ON ip_bans(ip);
```

### censor_words

敏感词过滤。

```sql
CREATE TABLE censor_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  find TEXT NOT NULL,             -- Word/pattern to find
  replacement TEXT NOT NULL DEFAULT '**',  -- Replacement text
  action TEXT NOT NULL DEFAULT 'replace'
    CHECK(action IN ('ban', 'replace')),  -- 'ban' = block post, 'replace' = censor
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_censor_words_find ON censor_words(find);
```

### settings

站点配置键值存储。

```sql
CREATE TABLE settings (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT NOT NULL UNIQUE,     -- Namespaced key (e.g., 'general.site.name')
  value TEXT NOT NULL DEFAULT '', -- Value as string (parsed by type)
  type  TEXT NOT NULL DEFAULT 'string'
    CHECK(type IN ('string', 'number', 'boolean', 'json')),
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_settings_key ON settings(key);
```

**Settings 命名空间：**

| Namespace | Description |
|-----------|-------------|
| `general.site.*` | 站点基本信息（名称、副标题、版权等） |
| `general.og.*` | Open Graph 元标签 |
| `general.pagination.*` | 分页设置 |
| `general.assets.*` | 静态资源配置 |
| `general.navigation.*` | 导航链接配置 |
| `features.access.*` | 访问控制（登录要求、维护模式） |
| `features.content.*` | 内容控制（发帖/回复开关） |
| `features.posting.*` | 发帖限制（新用户限制） |
| `features.registration.*` | 注册控制 |

### reports

用户举报管理。

```sql
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('thread', 'post', 'user')),
  target_id INTEGER NOT NULL,     -- ID of reported thread/post/user
  reporter_id INTEGER NOT NULL,
  reporter_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'resolved', 'dismissed')),
  handler_id INTEGER,             -- Admin who handled the report
  handler_name TEXT NOT NULL DEFAULT '',
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_type ON reports(type);
CREATE INDEX idx_reports_target ON reports(type, target_id);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
```

### admin_logs

管理员操作审计日志。

```sql
CREATE TABLE admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,           -- Action type (e.g., 'ban_user', 'delete_thread')
  target_type TEXT NOT NULL DEFAULT '',  -- 'user', 'thread', 'post', etc.
  target_id INTEGER,
  details TEXT NOT NULL DEFAULT '',  -- JSON or text description
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_action ON admin_logs(action);
CREATE INDEX idx_admin_logs_target ON admin_logs(target_type, target_id);
CREATE INDEX idx_admin_logs_created ON admin_logs(created_at DESC);
```

### announcements

站点公告。

```sql
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',  -- Markdown content
  forum_ids TEXT NOT NULL DEFAULT '',  -- Comma-separated forum IDs, empty = all forums
  sticky INTEGER NOT NULL DEFAULT 0,   -- Sort priority (higher = first)
  start_at INTEGER,               -- NULL = immediately visible
  end_at INTEGER,                 -- NULL = no expiration
  status INTEGER NOT NULL DEFAULT 1,  -- 0=draft, 1=published
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_dates ON announcements(start_at, end_at);
CREATE INDEX idx_announcements_sticky ON announcements(sticky DESC, created_at DESC);
```

### messages

站内私信。

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  receiver_id INTEGER NOT NULL,
  receiver_name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,          -- Message body (plain text or markdown)
  is_read INTEGER NOT NULL DEFAULT 0,
  sender_deleted INTEGER NOT NULL DEFAULT 0,    -- Soft delete for sender
  receiver_deleted INTEGER NOT NULL DEFAULT 0,  -- Soft delete for receiver
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);
CREATE INDEX idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);
```

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

> **⚠️ 实际迁移发现：** dump 中 `pre_common_member_archive` 为 0 条记录（表存在但无 INSERT 数据），`pre_common_member_count` 同样为 0 条记录。因此实际迁移中无用户被标记为 `status = -2`（归档），所有用户的 `threads`/`posts` 计数均为 0。这些数据缺失来自 dump 导出配置，非迁移脚本问题。

## D1 容量规划

### 实际数据测量（迁移结果，全量数据含占位记录）

| D1 Table | Rows | Content Size | Est. D1 Size (with indexes) |
|----------|------|-------------|---------------------------|
| posts | 9,510,896 | ~3,600 MB | ~4,500 MB |
| threads | 982,598 | ~220 MB | ~400 MB |
| users | 1,141,586 | ~230 MB | ~280 MB |
| attachments | 76,721 | ~22 MB | ~35 MB |
| forums | 218 | < 1 MB | < 1 MB |
| **合计** | **11,712,019** | **~4,070 MB** | **~5,200 MB** |

> 实际本地 SQLite 文件大小为 4.32 GB（含索引）。
> 占位记录分布：forums 5 条（status=-1），users 1,148 条（status=-3），threads 192,483 条（sticky=-99），posts 14 条（invisible=-1）。

### D1 限制（Workers Paid 计划）

| Limit | Value | Status |
|-------|-------|--------|
| 数据库大小 | **10 GB**（硬上限，无法提升） | ~4.3 GB 已用（实测） → ✅ 57% 余量 |
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

每种常见页面类型都必须命中索引。对 950 万条帖子进行全表扫描会导致 30 秒超时 + 大量行读取计费。

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
-- threads (982K rows, ~400 MB with indexes)
CREATE INDEX idx_threads_forum  ON threads(forum_id, sticky DESC, last_post_at DESC);  -- thread listing
CREATE INDEX idx_threads_author ON threads(author_id, created_at DESC);                -- user profile
CREATE INDEX idx_threads_latest ON threads(last_post_at DESC);                         -- homepage
CREATE INDEX idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0; -- digest listing
CREATE INDEX idx_threads_last_poster_id ON threads(last_poster_id);                    -- user profile link

-- posts (9.5M rows, ~4.5 GB with indexes)
CREATE INDEX idx_posts_thread ON posts(thread_id, position);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);

-- attachments (78K rows, ~35 MB with indexes)
CREATE INDEX idx_attachments_post   ON attachments(post_id);    -- post rendering
CREATE INDEX idx_attachments_thread ON attachments(thread_id);  -- thread attachments

-- forums
CREATE INDEX idx_forums_last_poster_id ON forums(last_poster_id);
CREATE INDEX idx_forums_visibility ON forums(visibility);

-- ip_bans
CREATE UNIQUE INDEX idx_ip_bans_ip ON ip_bans(ip);

-- censor_words
CREATE UNIQUE INDEX idx_censor_words_find ON censor_words(find);

-- settings
CREATE UNIQUE INDEX idx_settings_key ON settings(key);

-- reports
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_type ON reports(type);
CREATE INDEX idx_reports_target ON reports(type, target_id);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_created ON reports(created_at DESC);

-- admin_logs
CREATE INDEX idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_action ON admin_logs(action);
CREATE INDEX idx_admin_logs_target ON admin_logs(target_type, target_id);
CREATE INDEX idx_admin_logs_created ON admin_logs(created_at DESC);

-- announcements
CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_dates ON announcements(start_at, end_at);
CREATE INDEX idx_announcements_sticky ON announcements(sticky DESC, created_at DESC);

-- messages
CREATE INDEX idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);
CREATE INDEX idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);

-- users: UNIQUE(username) in CREATE TABLE already acts as an index
```

### 分页：使用 keyset，而非 OFFSET

D1（SQLite）在返回结果前会扫描 OFFSET 行。对 950 万条帖子执行 `OFFSET 50000` 是灾难性的。所有地方都使用 keyset（游标）分页：

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

**决策：完整保留 `closed > 1` 的 thread 记录。**

- 当 `closed > 1` 时，`closed` 的值是目标 thread 的 tid（重定向）
- 这些帖子的内容已经合并到目标 thread 中，只剩一个壳
- **完整保留**，应用层根据 `closed` 值做 redirect 处理
- 如果需要 URL 兼容（旧链接 `tid=xxx` 跳转），前端直接读 `closed` 字段做重定向，无需额外映射表

### 匿名/已删除作者

**决策：保留反范式化 `author_name` 字段。**

- DZ 在 `pre_forum_thread` 和 `pre_forum_post` 中同时存了 `authorid` 和 `author`（用户名）
- 即使 `authorid` 指向的用户被删除或不存在，`author_name` 仍然可以展示
- D1 schema 中的 FK 约束是逻辑约束（SQLite 默认不强制），不会因缺失用户导致写入失败
- 但迁移验证仍然要求 0 orphan — 全量迁移用户后，所有帖子的 `author_id` 应该都能关联到 `users.id`

### 占位记录（Placeholder Records）

**决策：FK 断裂时创建占位记录，保持引用完整性。**

迁移过程中发现大量 FK 断裂（帖子指向已删除的用户/主题/版块），使用占位记录而非跳过：

| 场景 | 占位策略 | 实际数量 |
|------|---------|---------|
| 主题 `forum_id` 不在 `forums` 中 | 创建占位版块（name=`[已删除版块{fid}]`, status=-1） | 5 |
| 主题/帖子 `author_id` 不在 `users` 中 | 创建占位用户（username=`[已删除用户{uid}]`, status=-3） | 1,148 |
| 帖子 `thread_id` 不在 `threads` 中 | 创建占位主题（subject=`[已删除主题{tid}]`, sticky=-99） | 192,483 |
| 附件 `post_id` 不在 `posts` 中 | 创建占位帖子（content=`[已删除帖子]`, invisible=-1） | 14 |
| 附件 `thread_id` 不在 `threads` 中 | 创建占位主题（同上） | 含在上述数量中 |

> 占位记录在迁移完成后可按 status/invisible/sticky 标记值识别和处理。应用层可选择隐藏或特殊展示。

### 隐藏帖子（invisible ≠ 0）

**决策：全量迁移，`invisible` 值透传。**

- DZ 中 `invisible` 含义：`0`=可见，`1`=待审核，`-1`=已删除，`-5`=已忽略
- 之前文档写"仅迁移 invisible=0"，已改为全量迁移
- 应用层根据 `invisible` 值决定展示策略（管理后台可看到所有帖子，前台仅展示 `invisible=0`）

### 数据源缺失与历史迁移遗留

**背景：** 该论坛经历过多次迁移，包括 Discuz! 自身版本的升级迁移。`uc_members`（UCenter 用户表）并非论坛初始就存在——它是 Discuz! 引入 UCenter 统一认证后新增的表。在某次迁移过程中，部分用户的扩展数据未能完整迁移过来。

**发现：dump 中两张表数据为空。**

| 表 | 预期 | 实际 | 影响 |
|---|------|------|------|
| `pre_common_member_count` | 7 万条（uid + threads + posts 计数） | 0 条 | 所有用户 `threads`/`posts` 字段为 0 |
| `pre_common_member_archive` | ~107 万条（归档用户详细数据） | 0 条 | 无用户被标记为 `status=-2`（归档） |

**用户数据完整度分析（迁移后实测）：**

| 用户分类 | 数量 | 说明 |
|---------|------|------|
| 有 member 数据 + 发过帖 | 68,512 | 核心活跃用户，数据完整 |
| 有 member 数据 + 未发帖 | 2,340 | 注册用户，数据完整 |
| 无 member 数据 + 发过帖 | 102,969 | ⚠️ 真实用户，缺少 status/role/credits/reg_date |
| 无 member 数据 + 未发帖 | 966,616 | 纯注册用户，缺少 member 元数据 |
| 占位用户（status=-3） | 1,148 | FK 修复产生 |
| 封禁用户（status=-1） | 1 | |
| **合计** | **1,141,586** | |

"无 member 数据"指仅存在于 `uc_members` 中（有 username/email/password），但在 `pre_common_member` 中无对应记录（role/credits/reg_date/avatarstatus 等均为默认值 0）。这 10.3 万发过帖的用户集中在 2002-2015 年，是论坛早期的真实用户，其 member 数据很可能在历次迁移中丢失。

**迁移后修正计划（TODO）：**

以下字段可在迁移完成后从已有数据中重新计算，无需依赖源表：

| 字段 | 修正方式 | 说明 |
|------|---------|------|
| `users.threads` | `SELECT COUNT(*) FROM threads WHERE author_id = ? AND sticky != -99` | 用户发起的主题数 |
| `users.posts` | `SELECT COUNT(*) FROM posts WHERE author_id = ? AND invisible = 0` | 用户的可见帖子数 |

其他缺失字段（`reg_date`、`credits`、`role`、`avatarstatus`）无法从帖子数据推算，需要从线上数据库补充导出 `pre_common_member_archive` 或通过其他方式恢复。
