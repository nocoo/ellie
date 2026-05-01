# 数据迁移指南

本文档描述从 Discuz! X3.4 MySQL 数据库迁移到 Ellie D1 的完整流程。

## 数据源

- **VPS**: `tongji.nocoo.cloud` (Azure 日本东部)
- **SSH**: `ssh nocoo@tongji.nocoo.cloud` (使用 `~/.ssh/id_rsa`)
- **MySQL 数据库**:
  - `db_tongji_main` — Discuz 主库
  - `db_tongji_ucenter` — UCenter 用户库

## Dump 文件清单

所有 dump 文件存放在 `reference/db/` 目录：

| 文件 | 大小 | 内容 | 状态 |
|------|------|------|------|
| `schema_all.sql.gz` | 24K | 完整 MySQL schema 定义 | ✅ 完整 |
| `ucenter.sql.gz` | 66M | `uc_members`, `uc_memberfields` | ✅ 完整 |
| `main_small.sql.gz` | 6.2M | `pre_common_member`, `pre_forum_forum`, `pre_forum_forumfield`, `pre_forum_attachment*` | ✅ 完整 |
| `thread.sql.gz` | 44M | `pre_forum_thread` | ✅ 完整 |
| `post_main.sql.gz` | 924M | `pre_forum_post` (主表) | ✅ 完整 |
| `post_shards.sql.gz` | 440M | `pre_forum_post_1~4` (分片表) | ✅ 完整 |
| `user_extra.sql.gz` | 48M | `pre_common_member_count*`, `pre_common_member_profile*`, `pre_common_member_status*`, `pre_common_member_field_forum*`, `pre_common_usergroup`, `pre_forum_threadtype` | ✅ 完整 |
| `moderator.sql.gz` | 1.2K | `pre_forum_moderator` | ✅ 完整 |
| `pm.sql.gz` | 66M | `uc_pm_*` 站内信表 (15 个表) | ✅ 完整 |

## 缺失数据导出

### 连接 VPS

```bash
ssh nocoo@tongji.nocoo.cloud
```

### 导出版主数据

```bash
mysqldump -u root db_tongji_main pre_forum_moderator \
  --skip-lock-tables --single-transaction \
  | gzip > /tmp/moderator.sql.gz
```

### 导出站内信数据

站内信存储在 UCenter 的多个分片表中：

```bash
# 导出所有 PM 相关表
mysqldump -u root db_tongji_ucenter \
  uc_pm_indexes \
  uc_pm_lists \
  uc_pm_members \
  uc_pm_messages_0 \
  uc_pm_messages_1 \
  uc_pm_messages_2 \
  uc_pm_messages_3 \
  uc_pm_messages_4 \
  uc_pm_messages_5 \
  uc_pm_messages_6 \
  uc_pm_messages_7 \
  uc_pm_messages_8 \
  uc_pm_messages_9 \
  uc_pms \
  uc_newpm \
  --skip-lock-tables --single-transaction \
  | gzip > /tmp/pm.sql.gz
```

### 下载到本地

```bash
# 从本地执行
scp nocoo@tongji.nocoo.cloud:/tmp/moderator.sql.gz reference/db/
scp nocoo@tongji.nocoo.cloud:/tmp/pm.sql.gz reference/db/
```

## 表映射关系

### D1 `users` 表

| D1 字段 | MySQL 源表 | MySQL 字段 | 备注 |
|---------|-----------|-----------|------|
| id | `uc_members` | uid | PK |
| username | `uc_members` | username | |
| email | — | — | 迁移时置空；旧邮箱未验证，用户需在新系统重新验证后写入 |
| password_hash | `uc_members` | password | |
| password_salt | `uc_members` | salt | |
| avatar | 计算 | uid | `avatars/{uid}.jpg` |
| status | `pre_common_member` | status, freeze | 0=正常, -1=封禁, -3=占位 |
| role | `pre_common_member` | adminid | 0=用户, 1=管理员, 2=超版, 3=版主 |
| reg_date | `pre_common_member` | regdate | Unix timestamp |
| last_login | `uc_members` | lastlogintime | Unix timestamp |
| threads | `pre_common_member_count` | threads | |
| posts | `pre_common_member_count` | posts | |
| credits | `pre_common_member` | credits | |
| signature | `pre_common_member_field_forum` | sightml | |
| group_title | `pre_common_usergroup` | grouptitle | 通过 groupid 关联 |
| group_stars | `pre_common_usergroup` | stars | |
| group_color | `pre_common_usergroup` | color | |
| custom_title | `pre_common_member` | customtitle | 实际字段待确认 |
| digest_posts | `pre_common_member_count` | digestposts | |
| ol_time | `pre_common_member_count` | oltime | 在线时长(分钟) |
| gender | `pre_common_member_profile` | gender | 0=未知, 1=男, 2=女 |
| birth_year | `pre_common_member_profile` | birthyear | |
| birth_month | `pre_common_member_profile` | birthmonth | |
| birth_day | `pre_common_member_profile` | birthday | |
| reside_province | `pre_common_member_profile` | resideprovince | |
| reside_city | `pre_common_member_profile` | residecity | |
| graduate_school | `pre_common_member_profile` | graduateschool | |
| bio | `pre_common_member_profile` | bio | |
| interest | `pre_common_member_profile` | interest | |
| qq | `pre_common_member_profile` | qq | |
| site | `pre_common_member_profile` | site | |
| last_activity | `pre_common_member_status` | lastactivity | |
| reg_ip | `uc_members` | regip | |
| last_ip | `pre_common_member_status` | lastip | |

### D1 `forums` 表

| D1 字段 | MySQL 源表 | MySQL 字段 | 备注 |
|---------|-----------|-----------|------|
| id | `pre_forum_forum` | fid | PK |
| parent_id | `pre_forum_forum` | fup | |
| name | `pre_forum_forum` | name | |
| description | `pre_forum_forumfield` | description | |
| icon | `pre_forum_forumfield` | icon | |
| display_order | `pre_forum_forum` | displayorder | |
| threads | `pre_forum_forum` | threads | |
| posts | `pre_forum_forum` | posts | |
| type | `pre_forum_forum` | type | group/forum/sub |
| status | `pre_forum_forum` | status | |
| last_thread_id | `pre_forum_forum` | lastpost | 解析 lastpost 字段 |
| last_post_at | `pre_forum_forum` | lastpost | 解析 lastpost 字段 |
| last_poster | `pre_forum_forum` | lastpost | 解析 lastpost 字段 |
| last_thread_subject | `pre_forum_forum` | lastpost | 解析 lastpost 字段 |
| moderators | `pre_forum_forum` | moderators | tab 分隔的用户名 |
| last_poster_id | 需计算 | - | 通过 last_poster 查 users |
| moderator_ids | `pre_forum_moderator` | uid | 关联版主表 |
| visibility | - | - | 默认 'public' |

### D1 `threads` 表

| D1 字段 | MySQL 源表 | MySQL 字段 | 备注 |
|---------|-----------|-----------|------|
| id | `pre_forum_thread` | tid | PK |
| forum_id | `pre_forum_thread` | fid | |
| author_id | `pre_forum_thread` | authorid | |
| author_name | `pre_forum_thread` | author | |
| subject | `pre_forum_thread` | subject | |
| created_at | `pre_forum_thread` | dateline | |
| last_post_at | `pre_forum_thread` | lastpost | |
| last_poster | `pre_forum_thread` | lastposter | |
| replies | `pre_forum_thread` | replies | |
| views | `pre_forum_thread` | views | |
| closed | `pre_forum_thread` | closed | |
| sticky | `pre_forum_thread` | displayorder | |
| digest | `pre_forum_thread` | digest | |
| special | `pre_forum_thread` | special | |
| highlight | `pre_forum_thread` | highlight | |
| recommends | `pre_forum_thread` | recommends | |
| post_table_id | `pre_forum_thread` | posttableid | |
| type_name | `pre_forum_threadtype` | name | 通过 typeid 关联 |
| last_poster_id | 需计算 | - | 通过 last_poster 查 users |

### D1 `posts` 表

| D1 字段 | MySQL 源表 | MySQL 字段 | 备注 |
|---------|-----------|-----------|------|
| id | `pre_forum_post[_N]` | pid | PK |
| thread_id | `pre_forum_post[_N]` | tid | |
| forum_id | `pre_forum_post[_N]` | fid | |
| author_id | `pre_forum_post[_N]` | authorid | |
| author_name | `pre_forum_post[_N]` | author | |
| content | `pre_forum_post[_N]` | message | 需 BBCode 转换 |
| created_at | `pre_forum_post[_N]` | dateline | |
| is_first | `pre_forum_post[_N]` | first | |
| position | `pre_forum_post[_N]` | position | |
| invisible | `pre_forum_post[_N]` | invisible | |

### D1 `messages` 表 (站内信)

UCenter 的 PM 系统使用会话模式，需要转换为简单的收发模式：

| D1 字段 | MySQL 源表 | MySQL 字段 | 备注 |
|---------|-----------|-----------|------|
| id | `uc_pm_indexes` | pmid | PK |
| sender_id | `uc_pm_messages_N` | authorid | 消息发送者 |
| sender_name | 需查询 | - | 通过 authorid 查 users |
| receiver_id | `uc_pm_members` | uid | 会话参与者(非发送者) |
| receiver_name | 需查询 | - | 通过 uid 查 users |
| subject | `uc_pm_lists` | subject | 会话主题 |
| content | `uc_pm_messages_N` | message | |
| is_read | `uc_pm_members` | isnew | 取反 |
| sender_deleted | `uc_pm_messages_N` | delstatus | bit 0 |
| receiver_deleted | `uc_pm_messages_N` | delstatus | bit 1 |
| created_at | `uc_pm_messages_N` | dateline | |

> **注意**: UCenter PM 是会话式的多人私信，转换到 Ellie 的双人私信模式需要特殊处理。

## 测试数据库演练

### 环境配置

- **测试 D1**: `tongjinet-db-test` (940c7758-0a9e-44b2-aeb5-745fa3143371)
- **测试 KV**: `ellie-test-kv` (490227e961174fd38c6c14530a4ee3ee)
- **Worker 环境**: `--env test --remote`

### 演练流程

#### 1. 清空测试数据库

```bash
# 删除所有表（保留 d1_migrations）
npx wrangler d1 execute tongjinet-db-test \
  -c apps/worker/wrangler.toml --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' AND name != 'd1_migrations';"

# 逐表删除
npx wrangler d1 execute tongjinet-db-test \
  -c apps/worker/wrangler.toml --remote \
  --command "DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS forums; ..."
```

#### 2. 应用 Schema

```bash
npx wrangler d1 migrations apply tongjinet-db-test \
  -c apps/worker/wrangler.toml --remote --env test
```

#### 3. 导入数据（逐表）

使用本地 SQLite 作为中转：

```bash
# 1. 将 MySQL dump 转换为 SQLite INSERT
# 2. 使用 wrangler d1 execute 批量执行

# 示例：导入 forums
npx wrangler d1 execute tongjinet-db-test \
  -c apps/worker/wrangler.toml --remote \
  --file scripts/import/forums.sql
```

#### 4. 验证各表

```bash
# 验证行数
npx wrangler d1 execute tongjinet-db-test \
  -c apps/worker/wrangler.toml --remote \
  --command "SELECT 'users' as tbl, COUNT(*) as cnt FROM users UNION ALL SELECT 'forums', COUNT(*) FROM forums UNION ALL ..."
```

### 导入顺序（考虑 FK 依赖）

1. `users` — 无依赖
2. `forums` — 无依赖
3. `threads` — 依赖 users, forums
4. `posts` — 依赖 users, forums, threads
5. `attachments` — 依赖 users, threads, posts
6. `messages` — 依赖 users

### 脚本位置

- `scripts/import/` — 导入脚本目录
- `scripts/verify-test-db.ts` — D1 隔离验证脚本

## 生产迁移检查清单

- [ ] 确认所有 dump 文件完整
- [ ] 测试数据库演练通过
- [ ] 验证行数与源数据库一致
- [ ] 验证 FK 完整性（无 orphan 记录）
- [ ] BBCode 转换器测试通过
- [ ] 头像文件同步到 R2
- [ ] 附件文件同步到 R2
