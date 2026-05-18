# 22 — 帖子评分功能（Post Rating · 定版）

> 作者：MBP-SDE-B
> 状态：**已实施（本地完成，待最终验收）** — Phase 1-6 全部落地（最新 commit `53aea49e`）。
> 实施提交范围：commit `c4d…` ~ `53aea49e`，覆盖 D1 migration、shared types、Worker create/get/revoke + aggregate batch、Web proxy + dialog + summary + action-bar 入口、`packages/migrate` 历史 ETL、最终文档与测试。后续 push origin 与 prod ETL apply 由哥决策，不在本期 SDE 自主范围。
> 取代草稿：`docs/21-post-rating.md`（保留作为调查/讨论历史）

---

## 0. 背景与依据

复刻旧站 Discuz 的"评分"功能：用户对帖子打分，把"积分"或"同钱"从评分者传递给被评分者。

**调查结论**（详见 #ellie-评分功能 thread d07b0041，SDE 报告 msg=71a6819e + Reviewer 复核 msg=2320d5f8）：
- 两种维度：
  - `credits` (extcredits1, 旧"积分") — 旧站 raterange 显示仅管理/版务类用户组开放评分。
  - `coins` (extcredits2, 旧"同钱") — 旧站所有正式注册用户组开放评分。
- 旧站 `isself=0` → 评分者**不扣自己**积分，纯白送给被评者。
- 旧站 `dupkarmarate=0` → 同 (uid,pid) 不可重复；`karmaratelimit=0` → 无时效限制。
- 每日额度走滚动 24h + `SUM(ABS(score))`。
- `pre_forum_ratelog` 共 63082 条（credits 18060 / coins 45022），范围 -999..+999。可作为冷启动种子。
- 旧站 `ratio=0`, `allowexchangein/out=N`：兑换机制本期不涉及。

---

## 1. 决策记录（@zheng-li 2026-05-18）

| # | 决策 | 取值 |
|---|------|------|
| 1 | 额度策略 | **硬编码常量**，二期再做 settings |
| 1a | 积分每日上限（按 role） | Mod=100 / SuperMod=200 / Admin=200 |
| 1b | 同钱每日上限（所有用户统一） | **5200 / 滚动 24h，不分角色** |
| 2 | `posts.rate / rate_times` 冗余列 | **不加**，实时聚合 |
| 3 | "通知作者" PM 的发件人 | 真人评分者，正文**自动生成**（不含自定义 BBCode） |
| 4 | 撤销时是否给被撤销者发 PM | **不发**；用 `post_ratings.revoked_at / revoked_by` + 结构化日志，不接 audit_logs |
| 5 | 历史 ratelog uid/pid 映射失败 | **丢弃** + warn 日志 |

---

## 2. 范围（MVP）

✅ 所有正式注册用户对**他人帖子**打"同钱"（dimension=2）。
✅ Mod / SuperMod / Admin 对**他人帖子**打"积分"（dimension=1）。
✅ 评分理由：从**预设列表**选 + 允许**手动输入**一条（max 40 字符，对齐旧站）。
✅ "通知作者" 复选框 → 自动生成 PM 内容并写入 `messages`。
✅ 帖子下方汇总展示：参与人数 + 各维度合计 +  "展开" → 浮层显示明细（评分者 / 维度 / 分值 / 理由 / 时间）。
✅ 历史数据 ETL → `post_ratings`；丢弃映射失败行。
✅ 撤销评分：仅 Admin / SuperMod，单条撤销。

⛔ 不做：
- 兑换 / 商城。
- 批量撤销。
- 撤销 PM。
- 通过 settings 表调整额度（二期）。

---

## 3. 权限矩阵

| role | 名称 | 同钱评分 | 积分评分 | 撤销 |
|------|------|----------|----------|------|
| 0 | User | ✅ | ❌ | ❌ |
| 3 | Mod | ✅ | ✅ | ❌ |
| 2 | SuperMod | ✅ | ✅ | ✅ |
| 1 | Admin | ✅ | ✅ | ✅ |

公共门槛（与旧站等价）：
- 必须登录、`status = Active(0)`、email 已验证（沿用现有写操作 gate）。
- 不能给自己评（`post.author_id === currentUserId` → 403）。
- 不能给匿名 / 屏蔽 / 已删除 / RecycleBin 帖子评（`invisible != 0 || author_id == 0` → 403）。
- 同一 `(uid, pid, dimension)` 只能存在一条**未撤销**的评分（旧站 `dupkarmarate=0`）。
- 滚动 24 小时额度按 `SUM(ABS(score))` 计算（见 §4）。

---

## 4. 额度规则（硬编码常量）

```ts
// apps/worker/src/lib/rating-limits.ts
export const RATING_LIMITS = {
  coins: {
    perDay: 5200,        // sum(|score|) 滚动 24h, 所有 role 统一
    perVoteMax: 100,     // 单次 |score| 上限（防一击拉满）
    perVoteMin: 1,       // 单次 |score| 下限
  },
  credits: {
    perVoteMax: 50,      // 单次 |score| 上限
    perVoteMin: 1,
    perDay: {            // 滚动 24h
      [UserRole.Mod]: 100,
      [UserRole.SuperMod]: 200,
      [UserRole.Admin]: 200,
    },
  },
} as const;
```

> 注：
> - 积分允许负分（扣分），同钱也允许负分。`perVoteMin/Max` 作用于绝对值。
> - 滚动 24h 额度查询：`SUM(ABS(score)) WHERE rater_id=? AND dimension=? AND revoked_at=0 AND created_at>=now-86400`。**`revoked_at=0` 关键**——撤销自动返还额度（旧站删除 ratelog 等价语义）。
> - `perVoteMax` / `perVoteMin` 为执行前与哥确认后采用的实现常量（防一击拉满 / 防 0 分），与 `perDay` 同源硬编码于 `apps/worker/src/lib/rating-limits.ts`，二期改 settings 表。

---

## 5. 数据模型

### 5.1 新表 `post_ratings`

```sql
-- apps/worker/migrations/0040_create_post_ratings.sql
CREATE TABLE IF NOT EXISTS post_ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL,        -- → posts.id
  thread_id   INTEGER NOT NULL,        -- 冗余，便于按 thread 聚合
  rater_id    INTEGER NOT NULL,        -- → users.id
  rater_name  TEXT    NOT NULL,        -- 冗余快照
  dimension   INTEGER NOT NULL,        -- 1=credits, 2=coins
  score       INTEGER NOT NULL,        -- 可正可负
  reason      TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER NOT NULL DEFAULT 0,
  revoked_by  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_post_ratings_post
  ON post_ratings(post_id, revoked_at, created_at);
CREATE INDEX idx_post_ratings_thread
  ON post_ratings(thread_id, revoked_at, created_at);
CREATE INDEX idx_post_ratings_rater_dim_time
  ON post_ratings(rater_id, dimension, created_at)
  WHERE revoked_at = 0;
CREATE UNIQUE INDEX uq_post_ratings_active
  ON post_ratings(rater_id, post_id, dimension)
  WHERE revoked_at = 0;
```

### 5.2 `posts` 表 **不增列**

每次展示走聚合：

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN dimension=1 THEN score ELSE 0 END) AS credits_sum,
  SUM(CASE WHEN dimension=2 THEN score ELSE 0 END) AS coins_sum
FROM post_ratings
WHERE post_id = ? AND revoked_at = 0;
```

**热路径接入点**（Reviewer 修正）：

帖子详情页是 `thread-detail.server.ts` **并行**调 `GET /api/v1/threads/:id` + `GET /api/v1/posts?threadId=...`。所以批量聚合要在后者 (`apps/worker/src/handlers/post.ts:list`) 里做：

1. 先拿到当前页 post ids（已有 `SELECT * FROM posts ... LIMIT ?`）。
2. 紧接着一次 GROUP BY 查询批量聚合：
   ```sql
   SELECT post_id,
          SUM(CASE WHEN dimension=1 THEN score ELSE 0 END) AS credits_sum,
          SUM(CASE WHEN dimension=1 THEN 1 ELSE 0 END) AS credits_count,
          SUM(CASE WHEN dimension=2 THEN score ELSE 0 END) AS coins_sum,
          SUM(CASE WHEN dimension=2 THEN 1 ELSE 0 END) AS coins_count
   FROM post_ratings
   WHERE post_id IN (?, ?, ...) AND revoked_at = 0
   GROUP BY post_id;
   ```
3. 在 enricher 把 aggregate 合到每个 post 行上（沿用 attachments batch 同样的 enrichment 模式）。
4. 同步扩展 `Post` / `EnrichedPost` 类型增加 `ratingAggregate?: RatingAggregate` 字段。

`GET /api/v1/posts/:id` 单帖端点也带上同样 aggregate（不需要明细 items）。
hover 明细仍走独立 `GET /api/v1/posts/:postId/ratings`，懒加载，避免列表页拉无用数据。

---

## 6. Worker API

### 6.1 端点

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/api/v1/posts/:postId/rate` | JWT 必需 | 创建一条评分 |
| `GET`  | `/api/v1/posts/:postId/ratings` | optional | 列表（聚合 + 明细），用于 hover |
| `POST` | `/api/v1/posts/:postId/ratings/:ratingId/revoke` | JWT + role∈{1,2} | 撤销一条评分 |

### 6.2 `POST /api/v1/posts/:postId/rate` 请求/响应

请求：
```json
{
  "dimension": "credits" | "coins",
  "score": -50,
  "reason": "灌水",
  "notifyAuthor": true
}
```

服务端处理（**guarded D1 batch**，Reviewer 修正）：

> ⚠️ D1 batch **不会**因为某条 statement 返回 `changes()=0` 而自动 rollback。唯一会让 batch 整体失败的是 SQL error（例如唯一索引冲突）。所以这里**不能**指望"`changes()=0` → 回滚整个 batch"，必须把后续每一步写入都用 `WHERE changes() > 0` 风格的条件 + 同样的额度子查询防御一遍，使额度不足时后续写入静默成为 no-op；batch 跑完后由 handler 检查首条 INSERT 的 `meta.changes` 来决定 429 / 200。

D1 batch 顺序：
1. 拉取 post + author + thread 状态 → 公共门槛校验（§3）。
2. 权限矩阵 + `|score|` 范围校验（纯应用层）。
3. **条件 INSERT 守护额度**（避免先读后写竞态）：
   ```sql
   INSERT INTO post_ratings
     (post_id, thread_id, rater_id, rater_name, dimension, score, reason, created_at, revoked_at, revoked_by)
   SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0
   WHERE (
     SELECT COALESCE(SUM(ABS(score)), 0)
     FROM post_ratings
     WHERE rater_id = ?
       AND dimension = ?
       AND revoked_at = 0
       AND created_at >= ?  -- now - 86400
   ) + ABS(?) <= ?;  -- limit
   ```
   - `WHERE revoked_at = 0` 关键：撤销后额度自动返还（与旧站删除 ratelog 语义一致）。
   - 该语句的 `INSERT ... SELECT ...` 在不满足条件时返回 `changes()=0`，不抛错。
4. **作者积分 update（用 `WHERE EXISTS` 守护，防止第 3 步未生效时仍打钱）**：
   ```sql
   UPDATE users
   SET coins/credits = coins/credits + ?
   WHERE id = ?
     AND EXISTS (
       SELECT 1 FROM post_ratings
       WHERE rater_id = ? AND post_id = ? AND dimension = ?
         AND created_at = ?  -- 与第 3 步同一 now 时间戳
         AND revoked_at = 0
     );
   ```
   - 用一条窄子查询确认刚才那条 rating 真的落库（同 rater+post+dim+created_at+revoked_at=0 唯一可定位），避免依赖跨 statement 的 `changes()` 状态。`revoked_at = 0` 关键：避免极端情况下同秒存在历史 revoked rating 时被旧行误命中 guard。
5. **PM insert 同样守护**（若 `notifyAuthor=true`）：
   ```sql
   INSERT INTO messages
     (sender_id, sender_name, receiver_id, receiver_name,
      subject, content, is_read, sender_deleted, receiver_deleted, created_at)
   SELECT ?, ?, ?, ?, ?, ?, 0, 0, 0, ?
   WHERE EXISTS (
     SELECT 1 FROM post_ratings
     WHERE rater_id = ? AND post_id = ? AND dimension = ?
       AND created_at = ?
       AND revoked_at = 0
   );
   ```
   - 这样额度不足时（第 3 步未插入）PM 也不会被写入。
6. Batch 跑完后，handler 检查**首条 INSERT 的 `meta.changes`**：
   - `= 0` → 额度耗尽 → 返回 `429 RATING_DAILY_LIMIT`（不需要 rollback，因为后续语句已经全是 no-op）。
   - `= 1` → 成功 → 返回 `{ rating, aggregate }`。
7. **唯一索引冲突**（重复 `(rater_id, post_id, dimension) WHERE revoked_at=0`）→ D1 batch 抛 error → handler catch → 返回 `409 RATING_DUPLICATE`。这是 batch 唯一会真正失败的路径。

**PM 字段与正文模板**：
- `sender_*` 取自评分者行（uid + 当前 username 快照）。
- `receiver_*` 取自 post 作者行。
- `subject` = `您收到一条评分`。
- `content` = 服务端拼接的纯文本模板：
  ```
  @{rater_name} 在《{thread_subject}》对您的回帖评分：
  [积分|同钱] {+N|-N}
  理由：{reason_plain or "（无）"}
  {post_url}
  ```
- **理由处理**（公开展示与 PM 共用同一份 `reason_plain`）：
  1. `trim`。
  2. 调用现有 `censor()` 敏感词替换。
  3. 调用现有 `escapeHtml()` / 纯文本化（去 BBCode/HTML 标记），不留富文本。
  4. 长度二次校验（trim 后 > 40 字符 → 400）。
  最终入库的 `post_ratings.reason` 也是这份 `reason_plain`，保证公开列表与 PM 一致。

错误码：
- `403 RATING_PERMISSION_DENIED` 角色无此 dimension 权限。
- `403 RATING_SELF` 给自己评。
- `403 RATING_INVALID_POST` 匿名/屏蔽/删除。
- `409 RATING_DUPLICATE` 已对该帖此维度评过且未撤销。
- `429 RATING_DAILY_LIMIT` 当日额度已耗尽。
- `400 RATING_SCORE_OUT_OF_RANGE` 单次范围越界。
- `400 RATING_REASON_TOO_LONG` reason > 40 chars。

### 6.3 `GET /api/v1/posts/:postId/ratings`

```ts
{
  postId: number;
  threadId: number;
  aggregate: {
    total: number;
    credits: { count: number; sum: number };
    coins:   { count: number; sum: number };
  };
  items: Array<{
    id: number;
    raterId: number;
    raterName: string;
    dimension: "credits" | "coins";
    score: number;
    reason: string;
    createdAt: number;
    revokedAt: number;
    canRevoke: boolean;  // 当前用户是否可撤销该条
  }>;
}
```

仅返回 `revoked_at = 0` 的明细（默认按 created_at DESC，limit 200，足够帖子级展示）。

**可见性门槛**（Reviewer 修正）：
- Optional auth，但必须先做 post → thread → forum 的 visibility 检查（沿用 `GET /api/v1/posts/:id` 与 `comments batch` 同一套 `loadVisiblePost()` / `loadVisibleThread()` helper）。
- 隐藏主题、staff-only 论坛、被屏蔽/删除的 post → 直接 404，不返回 aggregate 也不返回 items。
- 通过 visibility 后才执行聚合 + 明细查询。
- `canRevoke` 仅当 `currentUser?.role ∈ {1, 2}` 且该条 `revoked_at = 0` 时为 true。

### 6.4 `POST .../ratings/:ratingId/revoke`

- 仅 role∈{1,2}。
- 事务（D1 batch，与实现一致 — `apps/worker/src/handlers/post-rating.ts`）：
  1. 先单 SELECT 拿 `(post_id, rater_id, dimension, score, revoked_at, author_id)`。`revoked_at != 0` 或行不存在 → 404（不区分两种情况，避免泄露）。
  2. `UPDATE post_ratings SET revoked_at = ?, revoked_by = ? WHERE id = ? AND post_id = ? AND revoked_at = 0`。
  3. **作者积分反向 update（load-bearing 的 `changes() > 0` guard，Phase 3 amend blocker）**：
     ```sql
     UPDATE users
     SET coins/credits = coins/credits - ?
     WHERE id = ?
       AND changes() > 0
       AND EXISTS (
         SELECT 1 FROM post_ratings
         WHERE id = ? AND revoked_at = ? AND revoked_by = ?
       );
     ```
     - `changes() > 0` 不能省：D1 batch 在同一连接顺序执行，`changes()` 反映上一条 `UPDATE post_ratings`。如果省掉，**同秒双击撤销**场景下输家的 `UPDATE post_ratings` 是 0 行变更，但它的 `EXISTS` 仍会命中赢家刚写入的 `(revoked_at, revoked_by)` 元组，从而**重复扣作者积分**。该 guard 是 Phase 3 amend (`a8328...` 系列) 的修复结果。
  4. Batch 跑完后 handler 读首条 update 的 `meta.changes`：`= 0` → 404（已被别人撤销）；`= 1` → 走结构化日志 + 204。
  5. **结构化日志**（不接 audit_logs 基础设施）：
     ```
     console.warn('post_rating.revoke', JSON.stringify({
       actorId, ratingId, postId, dimension, score, raterId, authorId, at: now
     }));
     ```
     `post_ratings.revoked_at / revoked_by` 已经是审计快照；后续若上线 audit_logs，再补一份写入即可。
- 不发 PM。
- 返回 204（**空 body**，proxy route 同样保持 204 + empty body）。

---

## 7. 前端（apps/web）

### 7.1 入口

`post-action-bar.tsx` 左侧 user-actions 区域新增两个 ForumActionButton：

| Button | 图标 | label | 显示条件 |
|--------|------|-------|----------|
| 同钱 | `Coins` (lucide) | "同钱" | 已登录、`authorId > 0`（非匿名 / 非已删）、非自评 |
| 积分 | `Award` (lucide) | "积分" | 同上 + `role ∈ {Mod, SuperMod, Admin}` |

实现说明（与 `post-card.tsx` 一致）：

- `invisible != 0` 的 post 在 server filter 阶段就被剔除，客户端不再二次判断。
- **email 未验证用户依然能看到入口**；点击后走 `writeGatePreflight(selfEmailVerifiedAt, "rating")`，弹出与回复/点评/举报同一份未验证 / posting-restriction 提示（docs/17 §5.4 文案）。Worker 仍是最终 `EMAIL_NOT_VERIFIED` gate，proxy 透传扁平 payload。
- 这样做的好处：不会出现"入口神秘消失"的体验，未验证用户拿到的是清晰的引导提示。
- 撤销按钮不在 action-bar，而是放在 §7.3 popover 内每条明细行尾，仅 `canRevoke = true`（由 Worker 下发，前端不枚举权限）。

### 7.2 `PostRatingDialog`

复用 `editor-dialog-shell.tsx` 模式。新建 `components/forum/post-rating-dialog.tsx`：

字段：
1. **维度切换** — 入口已确定 dimension 时锁定显示。
2. **分值快捷按钮** — 根据 role + dimension 渲染允许的快捷值 (例：积分 Mod ±10/±20/±50；同钱 +1/+2/+3/+5/+10)，再带一个 ±N 自定义滑块（受单次/单日双重约束）。
3. **预设理由 dropdown**（client-side 常量数组，二期改 settings）：
   - 同钱：`热心助人 / 优秀文章 / 内容详实 / 鼓励原创 / 有理有据`
   - 积分：`内容优秀 / 精华推荐 / 违规扣分 / 灌水 / 重复发帖`
4. **理由文本框** — 选预设后自动填充，可编辑，max 40 字。
5. **通知作者** — 复选框，默认 ✔。

提交 → `POST /api/v1/posts/:postId/rate`，成功后：
- toast 提示。
- 触发 `PostRatingSummary` 重新拉取（或乐观更新 aggregate）。

### 7.3 `PostRatingSummary`

新建 `components/forum/post-rating-summary.tsx`，挂在 `post-card.tsx` 正文 + action-bar 之间（仅当 `aggregate.total > 0` 时渲染）。聚合数来自 `posts.list/get` 的 `ratingAggregate` enrichment（§5.2），首屏 SSR 即可显示，无需额外请求。

形态：
```
评分 · 12 人参与   ┃ 积分 +60   ┃ 同钱 +24      [展开 ▾]
```

展开交互（**click / keyboard，不是 hover**）：

- 实现：`@/components/ui/popover`（base-ui Popover，等价 radix click + 键盘触发），桌面 / 移动统一行为，无独立 drawer 分支。
- toggle 按钮可键盘聚焦（`focus-visible:underline`），按 Enter / Space 同样展开；可用 ESC 关闭，符合 a11y 最佳实践。
- **明细列表懒加载**：popover 首次打开才发起 `GET /api/v1/posts/:postId/ratings`，后续打开复用缓存（除非提交/撤销触发 invalidate）。`post-rating-flow.test.ts` 集成测试断言：toggle 之前 `fetchPostRatings` 调用 0 次，toggle 后恰好 1 次。
- 每条明细行：
  ```
  [avatar] @alice  积分 +5  「优秀文章」   2 分钟前  [撤销]
  ```
- 撤销按钮仅 `canRevoke = true` 时渲染（Worker 按 viewer role 下发），点击后乐观更新本地列表并触发 aggregate 减计。

### 7.4 历史数据展示

迁移后的 rating 行：`rater_id` 已映射；若 `users` 中该用户 `status = Tombstone(-99)` → `rater_name` 仍显示原冗余值但不可点击。

---

## 8. 历史数据迁移

规范路径（Phase 5/6 落地）：

- `packages/migrate/src/transform/ratelog.ts` — 纯函数（normalize / dedupe / mapping / SQL chunk / CSV / SUMMARY）。
- `packages/migrate/src/ratelog-etl.ts` — CLI driver，读取 dump + 映射 DB，写 `output/post-ratings-import-YYYY-MM-DD/`。
- `scripts/migrate/` 为旧版冷冻分支（见 `scripts/migrate/IMPORT-PLAN.md`），**不再修改**；正式 ETL 一律走 `packages/migrate/`。

1. 解压 `reference/db/2026-05-14/db_tongji_main_full.sql.gz`，抽 `pre_forum_ratelog` 行：`(pid, uid, username, extcredits∈{1,2}, dateline, score, reason)`。
2. 沿用 ETL 流水线中已有的 `uid → user_id` / `pid → post_id` 映射。映射失败 → **丢弃** + warn log。
3. **去重**（Reviewer 修正 — blocker 解除）：
   - Reviewer 扫描 dump 发现：按 `(pid, uid, extcredits)` 去重后是 62987 个 key，有 **69 个重复 key、95 条额外重复记录**（占 0.15%）。
   - 唯一索引 `UNIQUE(rater_id, post_id, dimension) WHERE revoked_at=0` 会拒绝重复，所以**必须在 ETL 阶段处理**，否则导入失败或静默丢数据。
   - 策略：**合并同 key 重复行**：保留 `MIN(dateline)` 那条作为代表，`score = SUM(score)`，`reason = MAX(LENGTH(reason)) 那条的 reason`（最长理由信息量最大），其他行丢弃。
   - 输出统计文件 `output/post-ratings-import-YYYY-MM-DD/SUMMARY.md`：总数 / 成功 / 因 uid 映射失败丢弃 / 因 pid 映射失败丢弃 / 因合并丢弃，附 dropped 与 merged 明细 CSV。
3a. **reason 清洗**（Phase 5 二审 blocker — msg=74219a93 解除）：`normalizeRatelogRow()` 必须先调用 `stripMarkup()`（与 Worker `processReason` 同一份正则）再做长度截断，否则历史 `[quote]…[/quote]` / `<script>` / `[color=red]…[/color]` 会原样泄漏到公共 hover 列表。ETL **跳过 censor**（历史内容已在线上多年），其它步骤（trim → stripMarkup → trim → cap）与新写入路径一致。Phase 5 重跑 dry-run 后 `rg '\[\w+\]'` 在生成 SQL 中零 BBCode 命中。
4. 拉取 `posts.thread_id` 填充 `thread_id` 冗余字段。
5. `extcredits` 直接复用为 `dimension`（1=credits, 2=coins）。
6. 输出 `output/post-ratings-import-YYYY-MM-DD/`：
   - `0001-insert-post-ratings-N.sql`（按 5000 条一段批，与 `04-threads.sql` / `05-posts-*.sql` 风格一致）。
   - `SUMMARY.md` + `dropped-uid.csv` / `dropped-pid.csv` / `merged.csv`。
7. **不重算用户 `credits / coins`**：用户聚合积分已通过 `pre_common_member_count` 迁移完成，再加会双倍。
8. 不需要 rebuild posts 列（§5.2 决策不冗余）。

执行：先 dry-run（输出 SQL 文件 + 统计），交哥 review `SUMMARY.md` 与 dropped/merged 列表，再人工 apply 到 prod D1。

---

## 9. 管理功能

- **撤销**：UI 入口在 §7.3 click/键盘 popover 内每条明细行尾，仅 `canRevoke=true`（后端按 role 下发）渲染。
- **审计**：本期**不接 audit_logs 基础设施**（当前 codebase 没有该表/调用）。
  - `post_ratings.revoked_at / revoked_by` 已是审计快照本身，可查"谁在何时撤销了哪条"。
  - 撤销操作额外打一条 `console.warn('post_rating.revoke', {...})` 结构化日志，落到 Worker stdout（Cloudflare Logs 可检索）。
  - 后续若上线统一 audit_logs，再补一份写入即可，不阻塞本 MVP。
- **Admin Console**：暂不做"评分日志查询"专属页面（二期），先依靠对 `post_ratings` 表的 admin 通用查询入口（沿用现有的 admin 用户/内容查询基础设施）。

---

## 10. 测试矩阵

### 10.1 D1 migration tests (bun:sqlite)
- `tests/unit/migration-0040-schema.test.ts`：表/索引/唯一约束。
- 唯一索引在 `revoked_at=0` 生效，撤销后允许同 (uid,pid,dim) 再评。

### 10.2 Worker handler unit tests (vitest)
- 创建：
  - User → 同钱 ✔
  - User → 积分 ✘ (403 PERMISSION_DENIED)
  - Mod → 积分 ✔
  - 对自己 ✘ (403 SELF)
  - 匿名/屏蔽帖 ✘ (403 INVALID_POST)
  - 同维度重复 ✘ (409 DUPLICATE)
  - 单次越界 ✘ (400 OUT_OF_RANGE)
  - 当日额度耗尽 ✘ (429 DAILY_LIMIT)
  - **条件 INSERT 并发场景**：模拟两个请求同时打分到差额度刚好的位置，断言只有一条成功、另一条 429（用 D1 batch 串行化模拟）。
  - 撤销后额度返还：撤销一条 → 同 rater_id+dim 当日剩余额度增加 = 撤销的 |score|。
- `notifyAuthor=true` → `messages` 表新增一行，sender/receiver 字段完整、reason 经 trim+censor+escape。
- GET：
  - 聚合数 + 明细 + `canRevoke` 按角色正确返回。
  - **可见性**：隐藏 thread / staff-only forum / invisible post → 404，不泄露 aggregate / items。
- 撤销：
  - Admin/SuperMod ✔（user/Mod 拒绝）
  - 反向更新 `users.credits/coins`
  - 写**结构化日志**（不写 audit_logs）
  - 不发 PM
  - 撤销已撤销的行 → 404

### 10.3 Web 测试（vitest + happy-dom + RTL）— 已落地

**Route-level（proxy）测试** — `apps/web/tests/unit/app/post-rating-proxy.test.ts`（16 cases）：
- `POST /api/v1/posts/:id/rate`：CSRF / 401 / 403 EMAIL_NOT_VERIFIED 扁平 payload 透传 / 409 RATING_DUPLICATE / 429 RATING_DAILY_LIMIT / 201 success。
- `GET /api/v1/posts/:id/ratings`（optional-auth）：anonymous fallback / authenticated `getAuth` / `getWorkerJwt` 抛错回退 anonymous / 404 NOT_FOUND / 500 INTERNAL_ERROR。
- `POST /api/v1/posts/:id/ratings/:ratingId/revoke`：CSRF / 401 / **204 空 body**（断言 `await res.text() === ""`）/ 404 NOT_FOUND / 403 FORBIDDEN_MOD_ONLY。

**Component 测试**：
- `post-rating-dialog.test.ts`：维度切换、预设分值/理由、单次范围、reason 长度、提交流程、错误展示。
- `post-rating-summary.test.ts`：0/1/N 条聚合渲染、popover 展开（click/键盘）、明细 list、撤销按钮可见性按 `canRevoke` 控制、撤销后聚合下调。

**Dialog → Summary 集成测试** — `apps/web/tests/unit/components/forum/post-rating-flow.test.ts`（2 cases）：
仿照 `post-card.tsx` 的 React 状态提升，把 dialog `onSuccess` 回写 aggregate 到父级，summary 仅在 `total > 0` 渲染。断言：
- 提交 payload 与 dimension/score/reason/notifyAuthor 完全匹配。
- 提交成功后 summary 出现，`*-total / *-coins / *-credits` 文本含新值（验证 React 真的 re-render，不是只挂 prop）。
- popover toggle 之前 `fetchPostRatings` 调用次数 0；toggle 之后恰好 1 次且参数 `42`；详情 list 渲染 rater + reason。
- 起始非零 aggregate + 再次提交场景：Worker 权威，aggregate **replace 不累加**。

### 10.4 浏览器手验（Playwright e2e 暂不做）

Playwright 多用户 / role 切换 seed 成本高（需要至少 2 个独立 session + Admin/Mod fixture + email_verified 状态切换），本期改为 §13 验收 Checklist 中的浏览器手验项。E2E 留为后续可选增强，不阻塞本期收口。

---

## 11. 实施步骤（原子化提交计划）

| # | Commit | 内容 |
|---|--------|------|
| 1 | `feat(db): add post_ratings table (0040)` | 新建 migration + schema test |
| 2 | `feat(types): post rating types & limits constants` | `packages/types/src/rating.ts` + 导出 |
| 3 | `feat(worker): POST /api/v1/posts/:id/rate handler + unit tests` | handler + lib/rating-limits + 条件 INSERT 守护额度 + unit tests |
| 4 | `feat(worker): GET /api/v1/posts/:id/ratings handler + unit tests` | 包含 visibility 复用 + canRevoke 下发 |
| 5 | `feat(worker): revoke endpoint + structured log + unit tests` | 结构化日志（不接 audit_logs） |
| 6 | `feat(worker): batch rating aggregate in posts list handler` | 在 `apps/worker/src/handlers/post.ts:list` 批量聚合，扩展 `Post/EnrichedPost` 类型；单帖 GET 同步带上 |
| 7 | `feat(web): Next.js proxy routes for rating endpoints` | `app/api/v1/posts/[id]/rate/route.ts` 等 |
| 8 | `feat(web): PostRatingDialog component + tests` | 含权限矩阵、表单校验 |
| 9 | `feat(web): PostRatingSummary component + tests` | click/键盘 popover + 懒加载明细 + 撤销按钮 |
| 10 | `feat(web): hook up rating buttons in post-action-bar` | 入口接入 |
| 11 | `feat(migrate): ratelog ETL script + dry-run output` | `packages/migrate/src/transform/ratelog.ts` + `packages/migrate/src/ratelog-etl.ts` + `output/post-ratings-import-*`，含去重合并、stripMarkup 与 SUMMARY.md |
| 12 | `feat(web,docs): post-rating phase 6 — proxy/integration tests + final docs` | route-level proxy tests（含 204 revoke + 错误透传）+ dialog↔summary RTL 集成测试（aggregate 提升 + 懒加载明细）+ docs/22 定版 + docs/21 SUPERSEDED + README 索引（commit `53aea49e`） |
| 13 | _Playwright e2e_ | 本期不做（多用户 + role 切换 seed 成本），转为 §13 浏览器手验项 |

每步本地 atomic commit，不主动 push（按 SDE 角色约定）。

---

## 12. 风险与依赖

- ✅ **audit_logs 决策**（Reviewer 已敲定）：本期不引入 audit_logs 基础设施。撤销审计以 `post_ratings.revoked_at / revoked_by` + 结构化日志为准。文档中关于 audit_logs 的写入、测试与验收项已全部删除（§6.4 / §9 / §10 / §13 同步更新）。
- ⚠️ **`messages` 表的 PM 写入** — 复用现有 schema（`0000_init_schema.sql` 已存在）。写入字段全集：sender_id / sender_name / receiver_id / receiver_name / subject / content / is_read / sender_deleted / receiver_deleted / created_at（见 §6.2）。
- ⚠️ **聚合查询性能** — 接入点是 `apps/worker/src/handlers/post.ts:list`（不是 thread detail）。按当前页 N 个 post id 一次 GROUP BY，已加索引 `idx_post_ratings_post`，预期 < 5ms。
- ⚠️ **历史 63082 条 ratelog 导入** — 单批 5000 行，约 13 批，估计 < 1 分钟完成。重复 key 95 条已在 §8 ETL 合并处理。
- ⚠️ **并发写入额度守护** — 用 `INSERT ... SELECT ... WHERE SUM(ABS(score))+ABS(?) <= limit`（§6.2 step 3）替代"先读 remaining 再 insert"，避免竞态。

---

## 13. 验收 Checklist（开发完毕后逐项核对）

### 自动化（已通过，本地）
- [x] D1 migration / Worker handlers 单测（`apps/worker/.../post-rating.test.ts`）45/45 pass。
- [x] Web proxy route + dialog + summary + flow 集成测试（`apps/web/tests/unit/...`）34/34 pass。
- [x] `packages/migrate/tests/ratelog.test.ts` 26/26 pass，输出 SQL `rg '\[\w+\]'` 零 BBCode 命中。
- [x] `bun run typecheck` 全仓库 clean。
- [x] `bunx biome check` 变更文件 clean。

### 浏览器手验（待哥 / Reviewer 在真实环境逐项 ✓）
- [ ] User 登录 → 帖子 action-bar 仅渲染"同钱"入口；Mod/SuperMod/Admin 渲染同钱+积分两个入口；自己帖子 / 匿名作者帖 / RecycleBin → 入口不渲染。
- [ ] email 未验证用户能看到入口；点击后弹出验证邮箱提示（与回复 / 点评同一份 §5.4 文案），Worker 拒绝并透传 EMAIL_NOT_VERIFIED。
- [ ] 评分 dialog：预设分值/理由可选可改、单次绝对值越界禁用提交、单日额度耗尽 → 429 提示。
- [ ] 提交成功 → toast + dialog 关闭 + summary 出现 + 作者 credits/coins 即时变更。
- [ ] Summary 行 click 或键盘 Enter 都能打开 popover；首次打开发起一次 ratings 请求，再次开关复用缓存；ESC 可关闭。
- [ ] popover 显示完整列表，撤销按钮仅 SuperMod/Admin 看到。
- [ ] Admin 撤销 → 列表行消失 / 灰显 + aggregate 减计 + author 积分回退；结构化日志 `post_rating.revoke` 出现在 Worker stdout。
- [ ] 撤销已撤销行 → 404，不泄露状态差异。
- [ ] 同秒双击撤销（开两 tab） → 仅一次扣回，第二次 404（依赖 §6.4 `changes()>0` guard）。
- [ ] `notifyAuthor` 勾选时被评者收到一条 PM，sender/receiver/subject/content 字段完整，理由经 trim+censor+strip。
- [ ] 隐藏 thread / staff-only forum / invisible post 的 GET ratings → 404，不泄露 aggregate / items。
- [ ] 历史 ETL：勾选后跑 `bun run packages/migrate/src/ratelog-etl.ts` dry-run → SUMMARY.md 行数计算正确、merged.csv 含 69 个 key / 95 条 source，生成 SQL 无 `[quote]` / `<script>`。prod 应用由哥决策。

### 不在本期范围
- Playwright e2e（成本/收益不划算，列入后续可选增强）。
- audit_logs 基础设施 / settings 表化的额度调整（二期）。
