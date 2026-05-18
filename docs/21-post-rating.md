# 21 — 帖子评分功能（Post Rating · 草稿，已被 docs/22 取代）

> **状态：SUPERSEDED**（保留作为调查 / 讨论历史）。
> 正式版定稿见 [`22-post-rating.md`](./22-post-rating.md)。本草稿不再维护，所有决策以 docs/22 为准。

## 0. 背景

复刻旧站 Discuz 的"评分"功能：用户对帖子打分，把"积分"（extcredits1）或"同钱"（extcredits2）从评分者传递给被评分者。

**调查结论摘录（详见 #ellie-评分功能 frequency d07b0041 thread）：**
- 两种维度：
  - **积分（credits, ext1）** — 仅管理类用户组可评。
  - **同钱（coins, ext2）** — 正式注册用户可评，游客/禁止访问/等待验证不可评。
- 旧站 `isself=0` → 评分**不扣评分者**自己的积分（白送给被评者）。
- 全局开关：`dupkarmarate=0`（同一用户同一 pid 不可重复）、`karmaratelimit=0`（无时效限制）。
- 每日上限是滚动 24 小时 + `SUM(ABS(score))`，不是自然日。
- 历史 `pre_forum_ratelog` 共 63082 条（积分 18060 / 同钱 45022），可作为冷启动种子。

## 1. 目标范围（MVP）

✅ 所有正式注册用户可对**他人帖子**进行"同钱"打分。
✅ 版主级及以上可对**他人帖子**进行"积分"打分。
✅ 评分理由：从预设列表选 + 允许手动输入一条。
✅ 可选"通知作者"：发送一条系统 PM（复用 `messages` 表）。
✅ 帖子下方汇总展示：参与人数 + 一行最近评分；hover 展开明细（评分者/维度/分值/理由/时间）。
✅ 历史数据导入：`pre_forum_ratelog` → 新表，并把汇总值填到 `posts.rate / rate_times`。
✅ 撤销评分：仅管理员（role=1）和超级版主（role=2）可见入口（按需，遵循旧站 `removerate`）。

⛔ **不做**（与旧站等价但本期省略）：
- 撤销评分的复杂分支（`removerate` 的二次 PM、可批量撤销等）—— 我们先支持"管理员单条撤销"。
- 兑换/商城（`allowexchangein/out`）——评分体系不依赖这块。
- "评分理由发出后转发"的隐藏 `from_idtype=rate` 关联—— 用普通 PM 即可。

## 2. 权限矩阵（按用户 `role` 落地）

旧站权限由 `usergroup_field.raterange` 承载；新系统只有 4 个 `UserRole`：

| role | 名称 | 评同钱 | 评积分 | 撤销 |
|------|------|--------|--------|------|
| 0    | User      | ✅ | ❌ | ❌ |
| 1    | Admin     | ✅ | ✅ | ✅ |
| 2    | SuperMod  | ✅ | ✅ | ✅ |
| 3    | Mod       | ✅ | ✅ | ❌ |

补充门槛（与旧站等价）：
- 必须已登录（且 `status = Active = 0`）。
- 未通过 email verify 的账号 → 拒绝（沿用现有写操作 gate）。
- 不能给自己打分（`post.authorId === currentUserId` → reject）。
- 不能给匿名 / 屏蔽 / 删除 / 回收站状态的帖子打分。
- 同一 (uid, pid, dimension) 只能评一次（旧站 `dupkarmarate=0`）。
- 每滚动 24 小时上限（参考旧站 `mrpd`，本期采用单一硬编码，后续可做 settings）：
  - User 同钱：`max ±5/次`、`mrpd=15`。
  - Mod / SuperMod / Admin 同钱：`max ±999/次`、`mrpd=50000`。
  - Mod 积分：`max ±50/次`、`mrpd=200`。
  - SuperMod / Admin 积分：`max ±500/次`、`mrpd=50000`。

> **决策点（请哥确认）**：上述每日额度是直接搬旧站三档（普通用户 / 版主 / 站务）的最低值。要不要用 `settings` 表做成可调？我建议先硬编码常量，二期再做。

## 3. 数据模型

### 3.1 新增表 `post_ratings`

```sql
-- migration 0040_create_post_ratings.sql
CREATE TABLE IF NOT EXISTS post_ratings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL,        -- → posts.id
  rater_id     INTEGER NOT NULL,        -- → users.id
  rater_name   TEXT    NOT NULL,        -- 冗余快照，避免改名后历史展示破裂
  dimension    INTEGER NOT NULL,        -- 1=credits(积分) | 2=coins(同钱)
  score        INTEGER NOT NULL,        -- 可正可负
  reason       TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,        -- unix seconds
  revoked_at   INTEGER NOT NULL DEFAULT 0,
  revoked_by   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_post_ratings_post ON post_ratings(post_id, revoked_at, created_at);
CREATE INDEX idx_post_ratings_rater_dim ON post_ratings(rater_id, dimension, created_at);
CREATE UNIQUE INDEX uq_post_ratings_rater_post_dim
  ON post_ratings(rater_id, post_id, dimension)
  WHERE revoked_at = 0;
```

### 3.2 `posts` 表新增冗余汇总（与旧站 `forum_post.rate / ratetimes` 同义）

```sql
-- migration 0041_alter_posts_add_rate_columns.sql
ALTER TABLE posts ADD COLUMN rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN rate_times INTEGER NOT NULL DEFAULT 0;
```

- 评分写入时事务内同步：`rate += score`、`rate_times += 1`（简化旧站的 `ceil(max(|min|,|max|)/5)` 权重，直接 +1 计次足够展示需要）。
- 撤销时反向同步。

> **决策点**：rate / rate_times 也可以只放在 `post_ratings` 上聚合查询，不冗余到 posts。但帖子列表/详情每次聚合 N 条 ratings 成本高，索引也吃。建议保留冗余列。

## 4. Worker API

### 4.1 端点

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/api/v1/posts/:id/rate` | JWT | 创建一条评分（同钱 或 积分） |
| `GET`  | `/api/v1/posts/:id/ratings` | optional | 返回该 post 的评分列表（聚合 + 明细，用于 hover） |
| `POST` | `/api/v1/posts/:id/ratings/:ratingId/revoke` | JWT + Admin/SuperMod | 撤销一条评分 |

### 4.2 `POST /api/v1/posts/:id/rate` 请求

```json
{
  "dimension": "coins" | "credits",
  "score": -5..+5 / -50..+50 / ...,
  "reason": "热心助人",
  "notifyAuthor": true
}
```

服务端处理（**单事务**）：

1. Auth + 拉取 post：
   - 不能给自己评、不能给匿名/屏蔽/已删除帖子评、不能重复评 (uid, pid, dimension)。
2. 权限矩阵 + 单次 score 范围 + 24 小时剩余额度（用 `post_ratings` 按 rater_id+dimension+created_at>=now-86400 的 SUM(ABS(score)) 计算）。
3. `INSERT INTO post_ratings ...`。
4. `UPDATE posts SET rate = rate + ?, rate_times = rate_times + 1 WHERE id = ?`。
5. `UPDATE users SET credits/coins = credits/coins + ? WHERE id = post.author_id`。
6. 若 `notifyAuthor` → `INSERT INTO messages` 一条系统级 PM：
   - subject: `您的帖子收到一条评分`
   - content: `[积分/同钱] +N — reason — <link to post>`
   - sender = 评分者本人（不抹掉身份，跟旧站一致）。
7. 返回新增 rating 行 + 当前 post 的 aggregate。

### 4.3 `GET /api/v1/posts/:id/ratings`

返回结构：
```ts
{
  postId: number;
  totalCount: number;
  byDimension: {
    credits: { count: number; sum: number; latest: RatingRow | null };
    coins:   { count: number; sum: number; latest: RatingRow | null };
  };
  items: RatingRow[];  // 默认按 created_at DESC，limit 50
}
```

未登录用户也可读（公开展示）。

### 4.4 `POST .../revoke`

- 仅 Admin / SuperMod。
- 事务：`UPDATE post_ratings SET revoked_at, revoked_by ... WHERE id = ? AND revoked_at = 0`；反向更新 `posts.rate / rate_times` 与作者积分。
- 不发 PM，写 `audit_logs`（沿用现有审计基础设施）。

## 5. 前端（apps/web）

### 5.1 入口位置

`post-action-bar.tsx` 左侧 user actions 区，"点评/回复"旁加：

- **同钱按钮** — 所有正式用户可见。
- **积分按钮** — `role >= 1 && role <= 3` 可见。
- **撤销按钮** — `role === 1 || role === 2` 可见，进入 ratings hover 后选择某条撤销。

不渲染给：未登录、status≠Active、自己的帖子、`post.authorId=0`（匿名）、被屏蔽的帖子。

### 5.2 评分对话框 `PostRatingDialog`

复用 `editor-dialog-shell.tsx` 模式。表单字段：

1. **维度切换**（如果同时拥有两种权限，否则锁定）。
2. **分值滑块/快捷按钮**：根据 role + dimension 显示允许范围，例：普通用户给同钱只能 `1,2,3,4,5`；版主积分 `±10, ±20, ±50`。
3. **预设理由 dropdown**（默认值 list，可由 settings 表后续配置）：
   - 同钱：`热心助人 / 优秀文章 / 内容详实 / 鼓励原创 / 有理有据 / 自定义...`
   - 积分：`违规扣分 / 灌水 / 内容优秀 / 精华推荐 / 自定义...`
4. **理由文本框**（可选，max 40 字符，对齐旧站 `char(40)`）。
5. **"通知作者"复选框**，默认勾选。

提交 → 调 `POST /api/v1/posts/:id/rate`。

### 5.3 帖子内展示

在 `post-card.tsx`（或新建 `post-rating-summary.tsx`）正文与 action-bar 之间增加汇总条：

```
评分 · 12 人参与 │ +24 同钱 │ +60 积分    [展开 ▾]
最近：@alice +5 同钱「热心助人」  · 2 分钟前
```

Hover 或点击"展开" → 浮层显示完整列表（`GET /api/v1/posts/:id/ratings`）：
- 每行 `头像 @用户名 +5 同钱 「理由」 时间`。
- 撤销按钮只对管理员/超版可见。

> **决策点**：列表用 popover (hover) 还是抽屉 (click)？建议默认 popover 触发，移动端 fallback 到点击展开（沿用 `post-comments.tsx` 已有模式）。

### 5.4 历史数据展示

迁移后的 `post_ratings` 行 `rater_id` 已映射到新 user_id；如果用户被 Tombstone (status=-99) 则展示 `[已删除]` + 不可点。

## 6. 数据迁移

新建 `scripts/migrate/transform/ratelog.ts`：

1. 解析 `reference/db/2026-05-14/db_tongji_main_full.sql.gz`：抽出 `pre_forum_ratelog` 行（pid, uid, username, extcredits∈{1,2}, dateline, score, reason）。
2. `uid` → 新 `user_id` 映射（沿用现有迁移流水线的 user 映射；缺失则映射到 Tombstone 占位 id）。
3. `pid` → 新 `post_id` 映射（沿用 posts 迁移）。
4. 输出 `output/post-ratings-import-YYYY-MM-DD/`：
   - `0001-insert-post-ratings.sql` （批 5000 一段）
   - `0002-rebuild-post-rate-sums.sql` （`UPDATE posts SET rate = SELECT SUM(score) ..., rate_times = COUNT(*) ...`）
   - `0003-rebuild-user-credits.sql` —— **不做**（用户积分 `credits/coins` 已经从 `pre_common_member_count` 迁过来，里面包含历史评分加成；重做会双倍）。

⚠️ **决策点**：历史 ratelog 中 `username` 与 `uid` 不一致（改名）时以 `uid` 为准；找不到 uid 映射的记录 → 丢弃 + warn log。和 #ellie-CICD 之前类似策略。

## 7. 测试矩阵

### 7.1 Worker handler unit tests
- 普通用户给同钱（正/负）— 成功/失败（自己/匿名/重复/超额度/超单次范围）。
- 普通用户给积分 — 拒绝。
- Mod 给积分 — 成功。
- Admin 给积分 + 撤销 — 成功 + 反向更新 + audit log。
- Mod 撤销 — 拒绝（403）。
- `notifyAuthor=true` 写出一条 PM。

### 7.2 D1 schema migration tests
- `migration-0040-schema.test.ts`、`migration-0041-schema.test.ts` 走 bun:sqlite。
- 唯一索引在 revoked_at=0 时生效，撤销后允许同一 (uid,pid,dim) 再评。

### 7.3 Web component tests (vitest + RTL)
- `PostRatingDialog` 表单：权限矩阵呈现、提交、错误展示。
- `PostRatingSummary` 渲染 0 / 1 / N 条 ratings 状态。

### 7.4 e2e（playwright）
- 普通用户 + mod + admin 各跑一次：登录 → 进入帖子 → 评分 → 看汇总 → （admin）撤销。

## 8. 实施步骤（每步原子 commit）

| # | 内容 | 文件 / 路径 |
|---|------|-------------|
| 1 | Migrations 0040 + 0041 + schema test | `apps/worker/migrations/` `tests/unit/migration-0040-schema.test.ts` |
| 2 | Worker types + handler `rate.ts` (POST + GET) + 单元测试 | `apps/worker/src/handlers/rate.ts` `tests/unit/rate-handler.test.ts` |
| 3 | Worker 撤销端点 + audit log | 同上 |
| 4 | Next.js 代理 routes | `apps/web/src/app/api/v1/posts/[id]/rate/route.ts` 等 |
| 5 | `PostRatingDialog` 组件 + 单测 | `apps/web/src/components/forum/post-rating-dialog.tsx` |
| 6 | `PostRatingSummary` 组件 + 接入 `post-card.tsx` | 同上 |
| 7 | `post-action-bar.tsx` 增加两个按钮 + 撤销入口 | 同上 |
| 8 | 历史数据 ETL + import SQL 生成 + dry-run | `scripts/migrate/transform/ratelog.ts` `output/post-ratings-import-*` |
| 9 | e2e playwright case | `tests/e2e/post-rating.spec.ts` |
| 10 | Docs README 索引更新 + retrospective | `docs/README.md` `CLAUDE.md` |

## 9. 风险 / 待澄清

- ❓ 每日额度是否走 settings 表？（§2 决策点）
- ❓ `posts` 增冗余列 vs 聚合查询？（§3.2 决策点）
- ❓ 历史 ratelog 与 `pre_common_member_count` 是否会重复结算？需要确认 §6 决策点。
- ❓ 撤销是否需要发 PM？（旧站 `removerate` 可配置，本期默认不发，只 audit log）
- ❓ "通知作者" PM 的 sender 用真人还是 system bot？（建议真人，跟旧站一致）

请哥 review 上述方案，重点确认决策点后我开始按 §8 的步骤实施。
