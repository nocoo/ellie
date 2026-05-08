# Ellie Data Import Plan — 2026-05-09

## Overview

Full re-import of Discuz data into D1, using **upsert** strategy for
users/forums (preserving child-table FK references) and **incremental insert**
for threads/posts/attachments.

## Source Data

All dumps are in `reference/db/2026-05-09/`:

| File | Discuz Tables | D1 Target | Strategy |
|------|--------------|-----------|----------|
| ucenter_members.sql.gz | uc_members | users (password, salt, email, last_login) | upsert |
| members.sql.gz | pre_common_member + archive | users (status, groupid, credits, avatar) | upsert |
| member_count.sql.gz | pre_common_member_count + archive | users (threads, posts, digest_posts, ol_time, coins) | upsert |
| member_profile.sql.gz | pre_common_member_profile + archive | users (gender, birth, reside, graduate, bio, interest, qq, site) | upsert |
| member_status.sql.gz | pre_common_member_status + archive | users (reg_ip, last_ip, last_activity) | upsert |
| member_field_forum.sql.gz | pre_common_member_field_forum + archive | users (custom_title, signature) | upsert |
| usergroup.sql.gz | pre_common_usergroup | users (group_title, group_stars, group_color) via groupid lookup | upsert |
| forums.sql.gz | pre_forum_forum + pre_forum_forumfield | forums | upsert |
| threads.sql.gz | pre_forum_thread + shards 1-7 | threads | incremental |
| posts.sql.gz | pre_forum_post + shards 1-4 | posts | incremental |
| attachments.sql.gz | pre_forum_attachment + shards 0-9 | attachments | incremental |
| checkins.sql.gz | pre_dsu_paulsign + pre_dsu_paulsign2 | user_checkins | upsert |
| postcomment.sql.gz | pre_forum_postcomment | (future) | deferred |

## Migration Code — Two Directories

There are two independent migration codebases:

| Directory | Entry point | Status |
|-----------|------------|--------|
| `packages/migrate/` | `bun run migrate` → `bun run --filter migrate start` | **Canonical.** 36 user columns (incl. campus from profile.field1), coins, usergroup, post_comments, forum moderators. Full ETL pipeline. |
| `scripts/migrate/` | `bun run scripts/migrate/index.ts` (manual) | **Frozen legacy.** 13 user columns, no profile/campus/coins. Reference only — do not modify. |

**All code changes in this plan target `packages/migrate/`.**

The `scripts/migrate/` directory will not be modified. If any existing scripts
(e.g. `scripts/migrate/import-v3.sh`) reference the old path, they should be
treated as legacy and not used for this import cycle.

### packages/migrate schema.ts vs D1 actual — status

`packages/migrate/src/load/schema.ts` currently has 36 user columns matching
D1's Discuz-owned columns. The remaining D1 columns fall into two categories:

#### To add in this import cycle (source-derived)

| D1 Column | Migration | Source | Action |
|-----------|----------|--------|--------|
| has_avatar | 0026 | Derived: `1` if `pre_common_member.avatarstatus > 0`, else `0` | Add to `packages/migrate` TABLE_DDL, TABLE_COLUMNS, extractUser(). Does NOT affect `avatar_path` (separate app-owned column). |

This brings the user column count to **37** after implementation.

#### Intentionally excluded (app-owned, no Discuz source)

| D1 Column | Migration | Why excluded |
|-----------|----------|-------------|
| avatar_path | 0027 | App-owned (R2 path, set by app upload flow) |
| purged_at | 0030 | App-owned (admin purge timestamp) |
| purged_by | 0030 | App-owned (admin who purged) |
| visibility | 0000 (forums) | App-owned (admin sets per-forum) |
| moderator_ids | 0000 (forums) | App-derived (populated by populate-moderator-ids.ts) |
| last_poster_id | 0000 (forums/threads) | App-derived (computed post-import) |

These columns use SQLite DEFAULTs on INSERT and are PRESERVED on upsert
(not in DO UPDATE SET).

### Column mapping reference (users)

`packages/migrate/src/extract/extractors.ts` already maps all Discuz sources:

| D1 Column | Discuz Source | Discuz Table |
|-----------|-------------|--------------|
| username, password_hash, password_salt, last_login | uc_members | db_tongji_ucenter.uc_members |
| status, role(adminid), reg_date, credits, avatar | pre_common_member | members.sql.gz |
| threads, posts, digest_posts, ol_time, coins(extcredits2) | pre_common_member_count | member_count.sql.gz |
| gender, birth_year/month/day, reside_province/city, graduate_school, bio, interest, qq, site, **campus(field1)** | pre_common_member_profile | member_profile.sql.gz |
| reg_ip, last_ip, last_activity | pre_common_member_status | member_status.sql.gz |
| signature(sightml), custom_title(customstatus) | pre_common_member_field_forum | member_field_forum.sql.gz |
| group_title, group_stars, group_color | pre_common_usergroup (via member.groupid) | usergroup.sql.gz |
| has_avatar | derived from avatarstatus | members.sql.gz |

**campus** has a confirmed Discuz source: `pre_common_member_profile.field1`
(values: 四平路校区, 嘉定校区, 校外人士, etc. per `0024_add_campus_field.sql`).
It is Discuz-owned and will be upserted.

## Strategy Details

### 1. Users — ON CONFLICT upsert (Discuz-owned columns only)

**Why not INSERT OR REPLACE**: SQLite `INSERT OR REPLACE` is semantically
`DELETE + INSERT`. On parent rows referenced by FK (threads.author_id,
posts.author_id, etc.), the DELETE step may fail or cascade. Even if it
succeeds, it resets ALL columns — including app-owned ones like `avatar_path`,
`email_verified_at`, etc.

**Correct approach**: `INSERT ... ON CONFLICT(id) DO UPDATE SET` — only
updates Discuz-sourced columns, preserving app-owned columns and FK references.

```sql
INSERT INTO users (
  id, username, email, password_hash, password_salt, avatar,
  status, role, reg_date, last_login, threads, posts, credits,
  signature, group_title, group_stars, group_color, custom_title,
  digest_posts, ol_time, gender, birth_year, birth_month, birth_day,
  reside_province, reside_city, graduate_school, bio, interest, qq, site,
  last_activity, reg_ip, last_ip, coins, has_avatar, campus
) VALUES (?, ?, ?, ...)
ON CONFLICT(id) DO UPDATE SET
  username        = excluded.username,
  password_hash   = excluded.password_hash,
  password_salt   = excluded.password_salt,
  avatar          = excluded.avatar,
  status          = excluded.status,
  role            = excluded.role,
  reg_date        = excluded.reg_date,
  last_login      = excluded.last_login,
  threads         = excluded.threads,
  posts           = excluded.posts,
  credits         = excluded.credits,
  signature       = excluded.signature,
  group_title     = excluded.group_title,
  group_stars     = excluded.group_stars,
  group_color     = excluded.group_color,
  custom_title    = excluded.custom_title,
  digest_posts    = excluded.digest_posts,
  ol_time         = excluded.ol_time,
  gender          = excluded.gender,
  birth_year      = excluded.birth_year,
  birth_month     = excluded.birth_month,
  birth_day       = excluded.birth_day,
  reside_province = excluded.reside_province,
  reside_city     = excluded.reside_city,
  graduate_school = excluded.graduate_school,
  bio             = excluded.bio,
  interest        = excluded.interest,
  qq              = excluded.qq,
  site            = excluded.site,
  last_activity   = excluded.last_activity,
  reg_ip          = excluded.reg_ip,
  last_ip         = excluded.last_ip,
  coins           = excluded.coins,
  has_avatar      = excluded.has_avatar,
  campus          = excluded.campus;
```

#### Users column ownership

| Owner | Columns | Behavior on import |
|-------|---------|-------------------|
| **Discuz-owned** (DO UPDATE) | username, password_hash, password_salt, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity, reg_ip, last_ip, coins, has_avatar, campus | Overwritten from source |
| **App-owned** (PRESERVED) | avatar_path, email, email_verified_at, email_normalized, email_changed_at, purged_at, purged_by | Never touched by import — keeps existing app values |

Note: `email` is set to `''` on initial INSERT (Discuz emails are unverified
legacy data), but preserved on UPDATE (user may have re-added via app).
`has_avatar` is derived from Discuz `avatarstatus` on insert but does NOT
overwrite `avatar_path` (separate column). `campus` is extracted from
`pre_common_member_profile.field1` (confirmed source per `0024_add_campus_field.sql`).

### 2. Forums — ON CONFLICT upsert (source-owned columns only)

```sql
INSERT INTO forums (
  id, parent_id, name, description, icon, display_order,
  threads, posts, type, status, last_thread_id, last_post_at,
  last_poster, last_thread_subject, moderators
) VALUES (?, ?, ?, ...)
ON CONFLICT(id) DO UPDATE SET
  parent_id           = excluded.parent_id,
  name                = excluded.name,
  description         = excluded.description,
  icon                = excluded.icon,
  display_order       = excluded.display_order,
  threads             = excluded.threads,
  posts               = excluded.posts,
  type                = excluded.type,
  status              = excluded.status,
  last_thread_id      = excluded.last_thread_id,
  last_post_at        = excluded.last_post_at,
  last_poster         = excluded.last_poster,
  last_thread_subject = excluded.last_thread_subject,
  moderators          = excluded.moderators;
```

#### Forums column ownership

| Owner | Columns | Behavior on import |
|-------|---------|-------------------|
| **Discuz-owned** (DO UPDATE) | parent_id, name, description, icon, display_order, threads, posts, type, status, last_thread_id, last_post_at, last_poster, last_thread_subject, moderators | Overwritten from source |
| **App-owned** (PRESERVED) | visibility, moderator_ids, last_poster_id | Never touched — visibility is manually set by admin, moderator_ids is populated by `populate-moderator-ids.ts`, last_poster_id is derived post-import |

### 3. Threads/Posts/Attachments — Incremental INSERT

```sql
-- Find max existing ID
SELECT MAX(id) FROM threads;
-- Only insert rows with id > max_id
INSERT INTO threads (...) VALUES (...);
```

Skip rows whose ID already exists in D1. This preserves all existing data
and only adds new content.

#### Threads source-owned columns (all, for INSERT)

id, forum_id, author_id, author_name, subject, created_at, last_post_at,
last_poster, replies, views, closed, sticky, digest, special, highlight,
recommends, post_table_id, type_name

App-derived (set to defaults on INSERT, not updated): last_poster_id

#### Posts source-owned columns (all)

id, thread_id, forum_id, author_id, author_name, content, created_at,
is_first, position, invisible

#### Attachments source-owned columns (all)

id, thread_id, post_id, author_id, filename, file_path, file_size,
is_image, width, has_thumb, downloads, created_at

### 4. Check-ins — ON CONFLICT upsert

```sql
INSERT INTO user_checkins (
  user_id, total_days, month_days, streak_days, reward_total,
  last_reward, mood, message, last_checkin_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  total_days      = excluded.total_days,
  month_days      = excluded.month_days,
  streak_days     = excluded.streak_days,
  reward_total    = excluded.reward_total,
  last_reward     = excluded.last_reward,
  mood            = excluded.mood,
  message         = excluded.message,
  last_checkin_at = excluded.last_checkin_at;
```

Only inserts checkins for users that exist in D1:
```sql
WHERE EXISTS (SELECT 1 FROM users WHERE id = ?);
```

Small table (2,797 rows). Old generated SQL in `reference/generated/` is
reference-only — must regenerate from today's dump using ON CONFLICT syntax.

## Pre-flight Checks

### D1 Backup

Run from `apps/worker/` (where `wrangler.toml` lives):

```bash
# Verify target database
cd apps/worker
npx wrangler d1 list  # confirm "tongjinet-db" is present

# Export current production D1 to local backup
npx wrangler d1 export tongjinet-db --remote --output ../../reference/d1-backups/2026-05-09/tongjinet-db-backup.sql
```

Database name: `tongjinet-db` (binding: `DB`, per `apps/worker/wrangler.toml`).
Test DB: `tongjinet-db-test` — do NOT touch production until dry-run passes on test.

### Local Dry-Run

1. Build local SQLite from dumps using `packages/migrate` (`bun run migrate`)
2. Run FK integrity check: `PRAGMA foreign_key_check;`
3. Compare row counts: source dump vs local SQLite
4. Sample spot-check: verify 10 random users have correct fields

### Validation Checklist

- [ ] Row counts match: users, forums, threads, posts, attachments, checkins
- [ ] FK integrity: no dangling references
- [ ] No duplicate usernames (UNIQUE constraint)
- [ ] Credits + coins values non-negative
- [ ] All thread.forum_id values exist in forums
- [ ] All post.thread_id values exist in threads
- [ ] All attachment.post_id values exist in posts
- [ ] Encoding: no GBK mojibake in usernames, subjects, or content

## Execution Order

1. **Backup D1** → `reference/d1-backups/2026-05-09/`
2. **Add `has_avatar` + upsert mode to `packages/migrate`** — add `has_avatar` to users DDL/TABLE_COLUMNS/extractUser() (derived from avatarstatus), then modify `packages/migrate/src/load/batch-insert.ts` to support ON CONFLICT DO UPDATE SET for users/forums/checkins (currently only does plain INSERT)
3. **Add checkin extractor to `packages/migrate`** — parse pre_dsu_paulsign/paulsign2 dumps
4. **Local dry-run** — `bun run migrate` with today's dumps, run validations
5. **Upsert users** — via wrangler d1 execute or batch SQL
6. **Upsert forums** — same
7. **Incremental threads** — only id > max existing
8. **Incremental posts** — only id > max existing
9. **Incremental attachments** — only id > max existing
10. **Upsert checkins** — ON CONFLICT(user_id) with EXISTS filter
11. **Post-import validation** — row counts, FK check, spot-check
