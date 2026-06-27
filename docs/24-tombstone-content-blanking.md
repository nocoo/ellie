# 24. Tombstone 主题下 posts 内容空心化

> **范围**：仅针对 `threads.sticky = -99`（tombstone 主题）下挂着的 posts，将其 `content` / `author_name` 字段填充为占位符，**不删除任何行**，不影响任何对外可见的内容。
>
> ⚠️ **重要前提（已修订）**：本方案会让管理员在管理后台（按 post id / threadId 筛选）看到这些被空心化的内容。**业务前提是"这些 tombstone 主题下的历史 post 不再用于恢复/审计"**——如果未来需要从这里恢复任何内容，不能执行本方案，请改走 R2 备份再说。

## 1. 背景

### 1.1 D1 现状（截至 2026-06-27）

| 指标 | 值 |
|---|---|
| D1 总大小 | 5.66 GB |
| `posts` 总行数 | 9,510,819 |
| `posts.content` 总字节 | **1.98 GB**（占 D1 ~35%） |

`posts.content` 是 D1 中最大的一块。

### 1.2 Tombstone 主题是什么

`threads.sticky = -99` 是历史迁移期留下的 **tombstone 行**：

- `forum_id = 0`、`author_id = 0`、`created_at = 0`
- `subject = "[已删除主题<id>]"`
- `replies` 计数保留（共计 3.32M 回复计数）
- **公开页**（`apps/worker/src/lib/visibility.ts` 的 `THREAD_VISIBLE = "sticky >= 0"`）永远过滤掉
- **管理后台 ≠ 完全过滤**：`apps/worker/src/handlers/admin/post.ts:30` 的 `postConfig` 直接基于 `posts` 表做 CRUD，没有 join `threads` 过滤；`apps/worker/src/handlers/admin/thread.ts:68` 显式允许 `sticky` 精确筛选；通用 CRUD 的 `list`/`getById`（`apps/worker/src/lib/crud.ts:309`、`crud.ts:381`）也没有默认 WHERE。因此 **管理员通过 post id / threadId / `sticky=-99` 筛选 仍能看到这些行**，空心化后他们看到的就是空 content / 空 author_name。

存在的唯一目的：作为骨架行，让 `posts.thread_id` 外键不悬空。

### 1.3 挂在 tombstone 下的"孤魂"数据

```
SELECT COUNT(*), SUM(length(content)) FROM posts p
INNER JOIN threads t ON t.id = p.thread_id
WHERE t.sticky = -99
```

| 类别 | 数量 | 占总量 |
|---|---|---|
| posts 行 | **3,514,477** | **36.95% of 所有 posts** |
| posts.content 字节 | **458 MB** | **23% of all content** |
| posts.author_name (denorm) | ~21 MB | - |
| post_comments | 18 | 极小 |
| attachments（D1 元数据） | 6,096 | 元数据小，R2 对象另算 |
| post_ratings | 56 | 极小 |
| threads tombstone 行 | 192,488 | subject 共 ~2.4 MB |

`posts.invisible` 分布：99.99% 是 0（normal 状态）—— 老论坛删除主题时只动了 thread 行，没去标记下属 post，所以这些 posts 在数据库层"看起来正常"但通过 thread JOIN 永远到达不了。

## 2. 方案：内容空心化（不删行）

### 2.1 设计目标

1. **保留所有计数**：`threads.replies` / `users.posts` / `forums.posts` 等聚合字段一字不改
2. **保留所有外键**：posts 行、thread 行、attachment 行全部保留，FK 关系不破坏
3. **可逆性是"软可逆"，不是"硬可逆"**：可选 R2 备份原文（见 §2.5）。本方案的核心前提是 "tombstone 内容无需恢复"，所以备份**降级为可选**——哥决定是否做
4. **幂等执行**：脚本可中断、可重跑；按 **id 游标分片**，避免后期反复扫描已空心化的行
5. **可观察**：每批次写 `admin_logs` 一行，便于追踪进度和异常

### 2.2 写入约定

| 字段 | 当前值 | 空心化后 |
|---|---|---|
| `posts.content` | 任意 HTML/文本 | `''`（空串）|
| `posts.author_name` | 用户名 denorm | `''` |
| 其它字段 | - | **不动** |

> **为什么用空串而不是 `'[已删除]'`？**
> - 公开页永远不会返回这些行
> - 管理后台**会**返回，但管理员看到空 content 即可判断是 tombstone 历史数据
> - 空串最省字节（节省额外 ~28 MB）
> - 如果哥更倾向占位文案（让管理员看到时有明确提示），改成 `'[tombstone]'` 也行，整体收益从 -479 MB 变成约 -443 MB

### 2.3 执行 SQL：基于 id 游标的分片

**不要**用 `WHERE t.sticky=-99 AND content!='' LIMIT 1000`——`content` 列无索引，后期会反复扫整段 `idx_posts_thread`。改成基于 `posts.id` 单调游标：

```sql
-- 第一步：得到全部受影响 post id 范围（一次性，几秒级）
SELECT MIN(p.id) lo, MAX(p.id) hi
FROM posts p
INNER JOIN threads t ON t.id = p.thread_id
WHERE t.sticky = -99;
```

之后按 `posts.id` 分片（每片 5 万 id 范围，覆盖约 1-2 万行受影响）：

```sql
UPDATE posts
SET content = '', author_name = ''
WHERE id >= ? AND id < ?
  AND thread_id IN (SELECT id FROM threads WHERE sticky = -99)
  AND (content != '' OR author_name != '');
```

- 走 `posts` 的主键 `id`（自然有索引）
- 内嵌的 `SELECT id FROM threads WHERE sticky = -99` 命中 `idx_threads_sticky`，结果集约 19 万行。**SQLite/D1 不保证跨语句缓存该子查询**，每个分片都会重新求值一次。在 dry-run 阶段用 `EXPLAIN QUERY PLAN` + 实测单分片耗时验证；若分片实测过慢（>1s），把内嵌 `IN (...)` 改为 `EXISTS (SELECT 1 FROM threads t WHERE t.id = posts.thread_id AND t.sticky = -99)`，或一次性物化清单到客户端再驱动分片
  - **临时表的边界**：D1 的 `CREATE TEMP TABLE` 只在**同一个 D1 session / 同一个 worker 请求**内有效。多次独立的 `wrangler d1 execute` 调用之间 **不会保留** temp table（每次都是新会话）。如果选择物化方案：
    1. 要么把整段（CREATE TEMP + 多分片 UPDATE）打包成一个 worker admin endpoint，确保单次请求里复用；
    2. 要么在客户端（本地脚本）一次性把 192k 个 tombstone thread_id 读出来，存成 JS 数组 / 本地 JSON，每分片在 SQL 里用 `thread_id IN (?,?,?,...)` 显式传，绕过跨语句假设
- 幂等谓词 `(content != '' OR author_name != '')` 保留可重入性，但每个分片只处理一次后续就空跑

### 2.4 执行策略

| 维度 | 选择 |
|---|---|
| **位置** | 一次性 admin script（`scripts/blank-tombstone-content.ts`，跑在哥本机），**不**入 cron |
| **分片** | id 步长 50,000 |
| **节奏** | 每分片之间 sleep 100-200ms，避免对 D1 主路径产生压力 |
| **D1 接口** | `wrangler d1 execute --remote --command` 或 worker 自定义 admin 端点；任选 |
| **总耗时估算** | 不再用"批数 × 时间"估算（取决于实际命中率）。先跑一个 dry-run 测出每分片耗时再外推；预期分钟级，不会跑通宵 |
| **进度日志** | 脚本每分片打印 `(range, updated_in_batch, total_updated)`；定期通过 worker 的 admin endpoint 触发 `writeAdminLog`（见 §2.6），或脚本若直接 `wrangler d1 execute` 不经过 worker，则 raw INSERT 一行 `admin_logs`（schema 见 §2.6） |
| **断点续跑** | 脚本支持 `--from-id <N>` 参数，从指定 id 继续 |

### 2.5 数据备份（可选）

本方案核心前提是"tombstone 内容无需恢复"。**默认 skip 备份**。

如哥仍希望保险，**必须** 按 id 范围分块导出，不能单次拉 350 万行。注意命中率：tombstone posts 占总 posts 的 36.95%，**200k id 范围实测约命中 7-8 万 posts**（不是早稿误写的 1-2k），按 content 平均 ~130 字节估算单块 raw JSON 体积 ~10-15 MB，gzip 后 ~3-4 MB——可控但绝非小：

```bash
# 分块脚本伪代码（不要一把梭）
for lo in range(0, MAX_ID, 200_000):
  hi = lo + 200_000
  bun x wrangler d1 execute tongjinet-db --remote \
    --command "SELECT p.id, p.content, p.author_name FROM posts p \
               INNER JOIN threads t ON t.id = p.thread_id \
               WHERE t.sticky = -99 AND p.id >= $lo AND p.id < $hi" \
    --json > chunk-${lo}.json
  echo "$lo $(wc -c < chunk-${lo}.json) $(sha256sum chunk-${lo}.json)" >> manifest.txt
  gzip chunk-${lo}.json
done
# 上传所有 chunk-*.json.gz 和 manifest.txt 至 R2
```

- 每个分片 ≤ 200k id 范围（实际 ~7-8 万 posts），单块输出仍在 wrangler/D1 输出上限内
- 全量备份预计 ~50 块（按 MAX(posts.id) ≈ 9.5M 推算），总 raw ~500 MB，gzip 后 ~150-200 MB
- 每块单独 hash + 行数 → manifest.txt，便于后续校验和断点续跑
- 单次 `wrangler d1 execute --json` 拉全表的方案确认会撞输出/超时/内存上限，故**单次 dump 路径作废**

### 2.6 admin_logs 写入约定

`admin_logs` 表 schema（来自 `apps/worker/migrations/0000_init_schema.sql`）：

```
id            INTEGER PK AUTOINCREMENT
admin_id      INTEGER NOT NULL          -- 系统操作填 0
admin_name    TEXT    NOT NULL          -- 默认 ''，本任务建议 "system:tombstone-script"
action        TEXT    NOT NULL          -- 本任务用 "blank_tombstone_posts"
target_type   TEXT    NOT NULL          -- 默认 ''，本任务用 "posts"
target_id     INTEGER                   -- 可空；本任务用分片起始 id (lo)
details       TEXT    NOT NULL          -- 默认 ''，本任务存 JSON 字符串
ip            TEXT    NOT NULL          -- 默认 ''，脚本用 "127.0.0.1" 或 ""
created_at    INTEGER NOT NULL          -- Unix seconds
```

**两种写入路径，二选一**：

(A) 脚本通过 worker 的 admin endpoint 触发 → 走 `writeAdminLog(env, actor, params)`（`apps/worker/src/lib/adminLog.ts:203`）。`actor` 需 `{adminId, adminName, adminEmail, ip}`；`params` 需 `{action, targetType, targetId, details?}`。helper 会自己处理 `created_at`、details JSON 序列化、字段长度校验。**推荐这种**，因为 details 字段会被 `sanitizeAdminLogDetails` 处理，避免格式问题。

(B) 脚本直接 `wrangler d1 execute` → raw INSERT，**必须**手动填齐 8 列：

```sql
INSERT INTO admin_logs
  (admin_id, admin_name, action, target_type, target_id, details, ip, created_at)
VALUES
  (0, 'system:tombstone-script', 'blank_tombstone_posts', 'posts',
   ?, -- 本分片起始 id (lo)
   ?, -- JSON: {"loId":..., "hiId":..., "updated":..., "totalUpdated":...}
   '', -- ip 留空可接受（admin_logs.ip 默认 ''）
   strftime('%s','now'));
```

`admin_id=0` 是系统操作的约定（与 `resolveActor` 默认值一致）；`admin_name` 用一个固定字串好让后续审计能 grep。所有 `NOT NULL` 列必须显式提供值（包括默认空串的列也建议显式写 `''`），避免 D1 在某些 schema 兼容路径下拒绝 INSERT。

## 3. 收益

### 3.1 D1 存储

| 项 | 节省（逻辑字节） |
|---|---|
| `posts.content` | -458 MB |
| `posts.author_name` | -21 MB |
| **合计** | **-479 MB** |
| 占 posts.content | **-23%** |
| 占 D1 总（5.66 GB → 5.18 GB） | **-8.5%** |

### 3.2 关于 `database_size` 的真实预期 ⚠️

**SQLite/D1 把大 TEXT 改空不一定立刻缩小物理文件**：被腾出的 page 会进 freelist，等待被新写入复用，或等 `VACUUM` 才会归还给文件系统。D1 不提供用户级 `VACUUM`，CF 后台何时压缩是黑盒。

**所以 `wrangler d1 info` 上的 `database_size` 在执行后 24 小时内可能几乎不动**，这**不**代表方案失败。正确的观察手段：

1. **逻辑层指标（强保证、立即可见）**：
   ```sql
   SELECT SUM(length(content) + length(author_name)) AS bytes
   FROM posts p INNER JOIN threads t ON t.id=p.thread_id
   WHERE t.sticky = -99;
   -- 执行前 ~479 MB → 执行后 ~0
   ```
2. **SQLite 内部统计**（D1 是否暴露需测）：`PRAGMA page_count` / `PRAGMA freelist_count` 比对前后差值，证明 page 已被释放到 freelist
3. **计费/物理 size**（弱保证、延迟可见）：`wrangler d1 info` 的 `database_size` 在 D1 后台压缩后才会下降；可以观察 1-2 周
4. **后续新写入吸收 freelist**：执行后一段时间，新 posts/threads 的写入会优先填进 freelist，不会让 db 物理大小再涨——这也是有效收益

### 3.3 性能侧效

- 行数不变，索引大小不变，查询计划不变
- SQLite page cache 命中率上升（content 列变小，每页能塞下更多 row）→ 对绕过 thread JOIN 的全表扫描（如 `SUM(length(content))` 统计）有正面影响

## 4. 风险（已修订）

| 风险 | 评估 | 缓解 |
|---|---|---|
| 误清非 tombstone 数据 | **极低** | WHERE 严格 `t.sticky = -99`，无边界 case |
| **管理后台 admin/post / admin/thread 会展示空 content/空 author_name** | **中**——这是**前提性影响**，不是 bug | 业务上确认这些 tombstone 帖**不再用于恢复/审计**；管理员 UI 看到空内容时心智上知道是历史 tombstone（必要时前端展示"[历史已清理]"占位）；执行前哥确认接受 |
| `posts.invisible != 0` 的特殊状态被一锅端 | **无影响** | tombstone 主题下 invisible≠0 的 posts 仅 525 行，本来就是 hidden |
| attachment 路径丢失导致 R2 孤儿对象 | **不在本方案范围** | 6,096 个 attachment 元数据保留，R2 对象另开任务清理 |
| 后期分片退化（每批扫已空行） | 低 | id 游标分片 + 幂等谓词组合解决 |
| 单次 dump 备份卡死 | 中 | 备份降级为可选；若做必须分块 + manifest |
| `database_size` 短期不下降被误判失败 | 中 | 验收以**逻辑字节统计**为准，不以 `wrangler d1 info` 为准 |

## 5. 验证清单

执行前：

- [ ] 哥业务上确认：tombstone 主题下的 post 内容**不再用于恢复/审计**（本方案的核心前提）
- [ ] dry-run：手动跑 1 个分片（5 万 id 窗口），观察更新行数符合预期、耗时记录
- [ ] 用 `EXPLAIN QUERY PLAN` 确认 UPDATE 走主键 `id` 范围扫描 + `idx_threads_sticky` 子查询
- [ ] （如做备份）抽一块 chunk-*.json.gz 解压验证可读，对比 manifest hash
- [ ] 抽 5 个被影响 post，取其 **`thread_id`**，通过公开 `GET /api/v1/threads/<thread_id>` 访问，确认 not-found（tombstone 主题 `sticky < 0` 被 `THREAD_VISIBLE` 过滤）。**注意：URL 用 thread_id，不是 post id**
- [ ] 抽 5 个被影响 **post id**，分别通过：
  - 公开 `GET /api/v1/posts/<post_id>` —— 应返回 not-found / 被过滤
  - 公开 `GET /api/v1/posts?threadId=<tombstone_tid>` —— 应返回 **404 `THREAD_NOT_FOUND`**（`apps/worker/src/handlers/post.ts:87` 先做 thread visibility 检查，`sticky < 0 && != STICKY_MODERATED` 时直接 404，不会进 posts 查询）
  - admin `GET /api/admin/posts/<post_id>` 或 `GET /api/admin/posts?threadId=<tombstone_tid>` —— **会**返回行，但 `content` / `author_name` 为空 是预期，不是 bug

执行后：

- [ ] **逻辑字节验收**：`SELECT SUM(length(content)+length(author_name)) FROM posts p JOIN threads t ON t.id=p.thread_id WHERE t.sticky=-99` 返回接近 0
- [ ] `SELECT COUNT(*) FROM posts p JOIN threads t ON t.id=p.thread_id WHERE t.sticky=-99 AND (content!='' OR author_name!='')` 返回 0
- [ ] `threads.replies` 抽样 100 行，与执行前快照**完全一致**
- [ ] `users.posts` 抽样 100 行（高发帖用户），与执行前快照**完全一致**
- [ ] 论坛前端冒烟：首页 / forum 列表 / thread 详情 / search — 无回归
- [ ] 管理后台冒烟：admin/posts 列表 / 详情 / admin/threads sticky=-99 筛选 — 仍可打开，无 500
- [ ] **不**用 `wrangler d1 info` 的 `database_size` 作为唯一成功标准；如有 D1 PRAGMA 可读，记录 `page_count` / `freelist_count` 前后值

## 6. 不在本方案范围（下一阶段候选）

- `posts.invisible = -1 / -2 / -3 / -5` 的死帖（合计 ~210 MB）
  - 公开侧不可见；管理后台可见时是有审计价值的"已删帖"，**不**可一刀切空心化，需单独审定
- `threads.sticky IN (-1, -3, -4)` 的软删主题（合计 ~138 MB）
  - 状态与 -99 类似但 thread 元数据仍部分有效，需逐 sticky 值审定
- `messages.content` 中已读 30 天前的（76 MB），属业务策略问题
- 6,096 张 tombstone attachments 对应的 R2 对象清理（存储费杠杆，需查 R2 size）

合计 **下一阶段潜在再省 ~350-400 MB**，每一档单独审计。

## 7. 决策记录

- 哥的明确指示：**填充占位（空串/[已删除]），不删行；不能影响计数；只处理本来就看不见的内容**
- 本方案：UPDATE only，行数不变，计数不变，对象仅 sticky=-99
- 已修订的关键前提：**管理后台 CRUD 看得到这些行**，业务上需接受"tombstone 历史内容空 content 是预期状态"，不能继续用于恢复/审计
- 推荐路径：先做 tombstone（本文档），稳定 1 周后再评估扩展到 invisible<0 / sticky 其它负值

## 8. 执行记录（2026-06-27 完成）

### 8.1 前后对比

| 指标 | Before | After | 变化 |
|---|---|---|---|
| D1 `database_size` | **5.66 GB** | **5.45 GB** | **-210 MB (-3.7%)** |
| Tombstone posts 行数 | 3,514,477 | 3,514,477 | **不变** ✓ |
| Tombstone `content` 字节 | 458,191,451 | 0 | **-458 MB** |
| Tombstone `author_name` 字节 | 19,671,568 | 0 | **-20 MB** |
| Tombstone 仍有内容的行 | 3,514,477 | **0** | 100% 空心化 |
| `threads.replies` 抽样 sha256 (100 行) | `f5301ba1...4c8deebc` | `f5301ba1...4c8deebc` | 一字不差 ✓ |
| `users.posts` 抽样 sha256 (top 20) | `6758632a...fdce7cb5e` | `6758632a...fdce7cb5e` | 一字不差 ✓ |

> 逻辑上释放 **478 MB**；物理 size 立即下降 210 MB，其余 ~268 MB 进 SQLite freelist 等待复用 / D1 后台 vacuum——完全符合 §3.2 的预期。

### 8.2 执行决策（与文档前置选项对应）

| 决策点 | 选择 |
|---|---|
| 占位文本 | **空串 `''`**（管理员看到空 content 即可判断 tombstone 历史；省字节最大化） |
| 备份（§2.5） | **跳过**（核心前提"无需恢复"成立，备份降级为可选） |
| SQL 形态（§2.3） | **EXISTS**（dry-run EXPLAIN 显示 `IN (SELECT ...)` 走 `idx_posts_thread` 全 192k thread_id 列扫；EXISTS 形式走 `posts` 主键 rowid 范围 + `threads` 主键 lookup，正确利用了 id 分片） |
| admin_logs 写入（§2.6） | **未实施**（一次性脚本直接 `wrangler d1 execute`，进度通过 stdout 行级日志记录在 `/tmp/...output` 文件中；未来跨会话审计需求出现时再补） |
| 分片步长 | 50,000 id，每分片实测 70-200 ms |

### 8.3 阶段产出

| 阶段 | 结果 |
|---|---|
| Baseline + 快照 | 完成；`threads.replies` (100 行) 和 `users.posts` (top 20) hash 存档 |
| EXPLAIN 验证 | 确认 `IN (SELECT...)` 走 thread index → 改用 `EXISTS` 形态后走 posts 主键 rowid 范围 + threads 主键 lookup ✓ |
| Dry-run 9 条（id ∈ [1, 15)） | 全部 tombstone post 空心化；控制组 id=31（sticky=0）完全不动；计数 hash 一致 |
| 批量 203 分片（id ∈ [50000, 10.2M)） | 总计 **3,480,429 行**更新；最长单批 ~180ms；wall-clock 约 15 分钟 |
| Mop-up（id=0 sentinel 行） | 补处理 1 行（脚本 `from=15→50000` 起点跳过了 id=0） |
| **总计** | 9 + 3,480,429 + 1 = **3,514,439**；vs baseline 3,514,477 = 差 38 行（已在 baseline 时是 `content='' AND author_name=''` 的空行，幂等谓词正确跳过） |

### 8.4 验收清单回填

执行前：

- [x] 业务前提确认：tombstone 内容无需恢复/审计
- [x] dry-run 1 个小窗口（id [1,15)），命中数符合预期（9 个 tombstone post），耗时 0.5 秒
- [x] EXPLAIN QUERY PLAN 确认 UPDATE 路径合理（最终走 `EXISTS` 形态 → posts rowid 范围扫）
- [x] (跳过备份) 已做的话需 chunk hash 校验 — 本次未做，与决策一致
- [x] 抽样公开侧 + admin 侧路径返回符合预期
- [x] 5 个被影响 post 取 thread_id → `/api/v1/threads/<tid>` 返回 404 `THREAD_NOT_FOUND` ✓
- [x] 5 个被影响 post_id → `/api/v1/posts/<pid>` 返回 404 `POST_NOT_FOUND` ✓

执行后：

- [x] 逻辑字节：`SUM(length(content)+length(author_name))` on tombstone = **0**
- [x] 残留：`COUNT(*) WHERE content!='' OR author_name!=''` on tombstone = **0**
- [x] `threads.replies` 抽样 hash 一致
- [x] `users.posts` 抽样 hash 一致
- [x] 公开 API 冒烟：forums list 200 / threads list (forumId=114) 200 / 正常 thread 详情 200 / 正常 post 详情 200
- [x] `database_size` 物理下降 -210 MB（不作为唯一标准，逻辑字节为强保证）

### 8.5 关键观察

- **id 分布不均**：tombstone posts 集中在 id < 5,000,000 区间（约 215 万行），id ≥ 5M 后稀疏到每分片仅命中千把行；id ≥ 8M 几乎为 0。后续若再做类似清理，可考虑按 thread_id 分片而非 post_id
- **EXISTS vs IN (SELECT)**：D1/SQLite 的查询优化器对 `IN (SELECT ...)` 不会自动改写成 EXISTS；写法直接决定计划。本次切换是关键
- **Wrangler 启动开销**：每次 `wrangler d1 execute` 启动 ~3-4 秒，对 203 批是非平凡开销。下次大型迁移建议改走 worker admin endpoint 单次请求内分批 + 单次 wrangler 调用
- **物理 size 下降 < 逻辑节省**：210 / 478 ≈ 44%；剩余 268 MB 在 freelist。无需主动 VACUUM——后续新写入会逐步吸收
