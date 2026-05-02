# 17 — Email Verification & Read-Only Gate

Status: **Revision 3 (simplified single-flow model)**
Owner: Claude-02 (impl) · Codex-02 (review)
Related: `04g-user-auth.md`, `api-architecture.md`, dove webhook (`POST /api/webhook/:projectId/send`)

## 0. Revision History

**Rev3 (2026-05-02) — Simplified single-flow model.**
旧设计同时支持「老用户 verify 现有邮箱」+「老用户 change to new email」+「新用户验证」三条路径，合并测试和 ops 复杂度高。新模型在导入阶段把所有 `users.email` 清空（extractor 已在上游 `87d790e` 实现，prod 由 ops 一次性 SQL 清空），统一只剩一种状态：

> 已登录 + 无邮箱 ⇒ 必须填新邮箱 + 验证 ⇒ 否则只读

Rev3 关键变化：
- 所有 `users.email / email_normalized / email_verified_at / email_changed_at` 在 prod ops 阶段一次性清零。
- 取消旧 §7.1 `POST /api/v1/users/me/email` (email-change endpoint)，合并进 §7.2 request-code 的请求体扩展。
- 取消旧 §6 email-change quota（首次补邮箱不计配额；将来已验证用户改邮箱由独立 RFC 引入 quota）。
- 旧 §11 / §12 4b backfill / find-duplicate scripts 作废（脚本和单测已 drop 出 history）。
- 中间件 (Phase 2) / 旧 7.2 / 7.3 endpoints (Phase 3) / migration 0028 / 0029 实现保留。
- §10.1 conditional UPDATE 加入 `email_verified_at = 0` guard，禁止已验证用户被覆盖；唯一索引 0029 仍是最终安全边界。
- **Decision (Rev3 §0)**：rev3 首次补邮箱场景下 `email_changed_at` 永远保持 `0`。仅当未来「已验证用户改邮箱」RFC 上线时，由该 RFC 决定何时写 `now()`。当前实现者请勿提前写入。

下文 §3–§16 保留旧版正文以便对照旧决策；rev3 真正生效的 endpoint / flow / phase 表格在本节之后已就地替换。

## 1. Background & Goal

The forum currently lets users register with any email string (the `users.email` column defaults to `''`) and start posting immediately. This has produced many fake / unverifiable email addresses, which blocks moderation, password recovery, and abuse response.

**Goal**: Force every existing and future user to verify a working email address before they can produce or mutate any forum content. Until then, their session is restricted to a strictly defined **read-only** mode plus the email-verification flow itself.

Verification emails are delivered via the local **dove** service over its existing webhook API.

## 2. Scope

### 2.1 In scope

- New per-user verification state (`email_verified_at`, `email_verification_required` semantics).
- Email change quota: **at most one successful change per rolling 24h** while unverified.
- Verification code lifecycle: generation, storage, TTL, resend throttle, attempt cap.
- A **read-only enforcement layer** in the Worker that blocks all mutating endpoints for unverified users.
- A small set of new endpoints to drive the flow.
- Frontend UX changes (banner + verification page + disabled write affordances).
- Integration with dove via an outbound HTTPS call from the Worker.
- Backfill / migration plan for existing users.
- Tests (unit + integration + e2e) and rollout / rollback plan.

### 2.2 Out of scope (explicit)

- Replacing the JWT auth scheme.
- 2FA / TOTP.
- Email change for users who **are** verified (treated as a separate future RFC; current behavior unchanged).
- Email deliverability / DMARC tuning (owned by dove).
- Admin tooling beyond a single "force re-verify user" toggle (future RFC).

## 3. Definitions

- **Unverified user**: an authenticated user whose `email_verified_at <= 0` (sentinel `0` = not verified). The column is `INTEGER NOT NULL DEFAULT 0`; `NULL` never appears.
- **Verified user**: `email_verified_at > 0` (Unix seconds at the moment of verification). Behavior unchanged from today.
- **Read-only mode**: the request gate applied to unverified users (see §5).
- **Verification code**: a 6-digit numeric code, server-generated, single-use, bound to `(user_id, email_normalized)`.

## 4. User Flow (Rev3)

1. 用户登录或注册，JWT 照常签发。
2. 后端 `me` / `login` response 暴露 `email_verified_at`；前端发现 `== 0` ⇒ 引导到 `/verify-email`，全站写操作 affordance disable。
3. `/verify-email` 页面只有一种交互：**输入邮箱 → 点击「发送验证码」**。
   - server 接到 §7.2 后只把 `(userId, normalized, displayEmail, codeHmac, ...)` 写进 KV，**不动 `users` 表**。
4. 用户输入 6 位 code + 同一邮箱 → §7.3 verify。
   - server 校验 `body.email` normalize 后必须等于 KV `pendingEmailNormalized`，否则 `409 EMAIL_CODE_EMAIL_MISMATCH`。
   - HMAC + attempts 校验通过后，conditional UPDATE 写入：
     - `users.email = <KV pendingEmail (display form)>`
     - `users.email_normalized = <KV pendingEmailNormalized>`
     - `users.email_verified_at = now()`
     - `WHERE id = ? AND email_verified_at = 0`（单向流程 guard，防止已验证用户被覆盖；唯一索引 0029 才是最终冲突兜底）
5. 唯一索引冲突 ⇒ 返回 `409 EMAIL_ALREADY_IN_USE`，前端提示换邮箱重试。
6. `email_changed_at` 在 rev3 首次补邮箱**保持 0**，绝不写 `now()`（见 §0 decision）。

> 旧 §4（rev2）三步流程（send code / change email / 输入 code）已被以上单流程取代。

## 5. Read-Only Gate

### 5.1 Allowed actions for unverified users

Verbatim list — anything not listed here is blocked. Endpoint paths are taken from `apps/worker/src/index.ts` as of HEAD (`9d5b615`).

| Action | Endpoint(s) |
|---|---|
| Login | `POST /api/v1/auth/login` |
| Refresh token | `POST /api/v1/auth/refresh` |
| Logout | `DELETE /api/v1/auth/logout` |
| Register | `POST /api/v1/auth/register` |
| Read own session | `GET /api/v1/auth/me` |
| Browse forums / threads / posts (read) | All existing public `GET` routes |
| Read messages metadata | `GET /api/v1/messages`, `GET /api/v1/messages/unread-count`, `GET /api/v1/messages/:id` |
| **Request verification code (with pending email)** | `POST /api/v1/users/me/email/request-code` *(rev3 — body now carries pending `email`)* |
| **Submit verification code** | `POST /api/v1/users/me/email/verify` *(rev3 — body now carries `{ email, code }`)* |
| Change password | `POST /api/v1/users/me/password` |

### 5.2 Blocked actions for unverified users

Default-deny on write (see §5.3). Concretely the following routes flip from `withAuthVerified` / `authMiddlewareVerified` / `moderationMiddleware` to the new `requireVerifiedEmail` chain:

| Endpoint | Current wrapper | After |
|---|---|---|
| `POST /api/v1/threads` | `authMiddlewareVerified` (inline) | `requireVerifiedEmail` |
| `POST /api/v1/posts` | `authMiddlewareVerified` (inline) | `requireVerifiedEmail` |
| `PATCH /api/v1/me/posts/:id`, `DELETE /api/v1/me/posts/:id` | `withAuthVerified` | `withVerifiedEmail` (new wrapper, §5.3) |
| `DELETE /api/v1/me/threads/:id` | `withAuthVerified` | `withVerifiedEmail` |
| `POST /api/v1/post-comments` | `withAuthVerified` (`post-comment.ts:create`) | `withVerifiedEmail` |
| `POST /api/v1/messages`, `DELETE /api/v1/messages/:id`, `POST /api/v1/messages/mark-all-read` | `withAuthVerified` (`message.ts`) | `withVerifiedEmail` |
| `POST /api/v1/reports` | `withAuthVerified` (`report.ts:create`) | `withVerifiedEmail` |
| `POST /api/v1/upload` | `authMiddlewareVerified` (inline at index.ts:215) | `requireVerifiedEmail` |
| `PATCH /api/v1/users/me` (profile, excl. email) | `withAuthVerified` (`me.ts`) | `withVerifiedEmail` |
| `POST /api/v1/users/me/password` | `withAuthVerified` | **unchanged** — explicitly allowed for unverified (§5.1) |
| All `/api/v1/moderation/*` mutating routes | `moderationMiddleware` | `moderationMiddleware` + verified check (§5.3) |

Out of scope for this RFC: `/api/admin/*`. These are **Key B-only** (no end-user JWT — they are server-to-server from the Next.js admin app). There is no actor JWT to gate on, so the verified-email check does not apply at the Worker layer. Admin-console session ownership is governed by the existing admin login (`docs/10-admin-console.md`) and is **not modified by this RFC**. A follow-up RFC may add "admin user must verify their forum email" if needed; for now this is explicitly out of scope.

### 5.3 Implementation strategy

Two new pieces in `apps/worker/src/middleware/auth.ts`:

```
requireVerifiedEmail(request, env)
  → result of authMiddlewareVerified(request, env)
  → if user.email_verified_at <= 0 → 403 EMAIL_NOT_VERIFIED
  → else { user }
```

And a matching wrapper in `apps/worker/src/lib/routeHelpers.ts`:

```
withVerifiedEmail(handler)  // analogous to withAuthVerified, but uses requireVerifiedEmail
```

For the moderation chain, extend `moderationMiddleware` with the same verified-email check (mods/admins are not exempt — confirmed in §13).

Then:
- In `index.ts`, switch the inline `authMiddlewareVerified` calls (`POST /threads`, `POST /posts`, `POST /upload`) to `requireVerifiedEmail`.
- In each `handlers/*.ts` listed in §5.2, switch the import from `withAuthVerified` to `withVerifiedEmail`.
- Verify in code review that no mutating route uses `withAuth` (un-verified, un-banned) — that wrapper exists for read-only consumers; default-deny rule says it must not be used for writes.

Default-deny rule: any new route added later that mutates state must opt **in** to allowing unverified users by explicitly using `withAuthVerified` and adding it to the §5.1 allow-list (with reviewer sign-off). Otherwise verification is enforced via `withVerifiedEmail`.

The frontend additionally hides write affordances, but the Worker is the source of truth.

## 6. Data Model

> **Rev3 note:** §6 column set unchanged. Only `email_changed_at` 的语义在 rev3 被收紧为「永远保持 0，直到独立 RFC 引入 verified-user email change」。
> 旧 §6.3 email change ledger 仍 deferred；不影响 rev3。
> 旧 §6 quota 段（"1 change per 24h while unverified"）已 **REMOVED in rev3** — 见 §0。

### 6.1 `users` table (additive only)

```sql
ALTER TABLE users ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0;
-- 0 means "not verified". Unix seconds when verified.
ALTER TABLE users ADD COLUMN email_normalized TEXT NOT NULL DEFAULT '';
-- Lowercased + trimmed snapshot of email. Maintained by application layer
-- on every email write. Rev3: ops clear leaves empty normalized values
-- across the table; the 0029 unique partial index applies only to
-- non-empty values (`WHERE email_normalized != ''`), so empty rows do
-- not collide with each other.
ALTER TABLE users ADD COLUMN email_changed_at INTEGER NOT NULL DEFAULT 0;
-- Rev3: stays 0. Reserved for a future "verified user changes email" RFC;
-- the rev3 first-add flow MUST NOT write this column. (Rev2 used this for
-- a 1-change-per-24h quota that has been removed in rev3.)
```

Notes:
- `email_verified_at = 0` is the unverified sentinel. Code reads it via `email_verified_at > 0`.
- We deliberately do **not** add a `verification_code` column on `users`. Codes live in KV (§6.2).
- Email comparison everywhere uses `email_normalized` (lowercase + trim). The display form in `email` is preserved as the user typed it.

### 6.2 Verification code storage (KV)

Codes live in Cloudflare KV (existing binding) under:

```
key:    email_verify:<userId>
value:  JSON { code_hmac, target_email_normalized, expires_at, attempts, last_sent_at }
TTL:    900 seconds (15 min) at write time
```

- `code_hmac`: `HMAC-SHA256(server_secret, "<userId>:<target_email_normalized>:<code>")`, hex-encoded. The 6-digit space (10⁶) is small enough that an unsalted hash is offline-brute-forceable in milliseconds; HMAC with a server-side secret prevents that even on full KV exfiltration. Equivalent to a per-record salted KDF for this code length.
- `server_secret`: a new Worker secret `EMAIL_VERIFY_HMAC_KEY` (set via `wrangler secret put`). Rotating it invalidates all in-flight codes — acceptable, users can re-request.
- `attempts`: integer, capped at **5** before the code is invalidated and a new one must be requested.
- `last_sent_at`: epoch seconds, used by the **resend throttle**.

### 6.3 Email change ledger (optional, deferred)

For audit, a small `email_change_log` table is **not** part of phase 1 to keep blast radius small. Recorded only via application logs in phase 1; if ops wants a queryable trail, a follow-up RFC.

## 7. New API Endpoints (Rev3)

All live under `/api/v1/users/me/email*`. All require valid JWT (`authMiddlewareVerified`) but **not** verified status.

> **Rev3 §7.1 — REMOVED.** 旧 `POST /api/v1/users/me/email` (email-change endpoint) 不再存在。其唯一作用——把新邮箱写进 `users.email`——已被合并到 §7.2 / §7.3 流程；`users.email` 只在 §7.3 verify 成功后被一次性原子写入。

### 7.2 `POST /api/v1/users/me/email/request-code` (Rev3)

Request:
```json
{ "email": "user@example.com" }
```

Behavior:
- Normalize body.email (`lower(trim(...))`)，长度 ≤ 254、RFC-style regex；失败 ⇒ `400 EMAIL_INVALID`。
- **不写 `users` 表**。所有 pending 状态都在 KV record 内。
- KV record 形状（rev3）：
  ```json
  {
    "codeHmac": "<hex>",
    "pendingEmail": "<as typed (trimmed)>",
    "pendingEmailNormalized": "<lower(trim)>",
    "expiresAt": 1714576800,
    "attempts": 0,
    "lastSentAt": 1714575900
  }
  ```
- HMAC payload 仍是 `<userId>:<pendingEmailNormalized>:<code>`，绑定本次 request 的 pending email。
- 任何新 request 覆盖旧 KV record，旧 code 立即失效——防止用户用「A 邮箱页面的 code」误验证「B 邮箱 pending」。
- 重发 throttle / in-flight lock 复用现有实现（60s resend / KV in-flight lock）。
- 通过 dove 把 code 发到 `pendingEmail`（display form）。
- 仅在 dove 200 后才持久化 KV / `lastSentAt`（dove 失败不烧 throttle）。

Response 200（rev3 mask 不变）：
```json
{ "sent_to": "u***@example.com", "expires_in": 900, "next_resend_allowed_at": 1714576800 }
```

Errors（与 rev2 相同 + 一条新增）：
- `400 EMAIL_INVALID` — body.email 缺失 / 格式不合法。
- `403 EMAIL_ALREADY_VERIFIED` — 当前用户 `email_verified_at > 0`。rev3 单向流程下不允许已验证用户重新走此 endpoint。
- `429 CODE_RESEND_THROTTLED`、`502 EMAIL_PROVIDER_FAILED`：同 rev2。

### 7.3 `POST /api/v1/users/me/email/verify` (Rev3)

Request:
```json
{ "email": "user@example.com", "code": "123456" }
```

Behavior:
- Normalize body.email；要求等于 KV `pendingEmailNormalized`，否则 `409 EMAIL_CODE_EMAIL_MISMATCH`（场景：多 tab / 用户重输 email / pending 被新 request 覆盖）。
- HMAC 重算 `<userId>:<KV pendingEmailNormalized>:<body.code>`；constant-time 与 KV `codeHmac` 比较。
- `attempts` 校验同 rev2（5 次后 KV 删除 + `403 CODE_LOCKED`）。
- 成功后 conditional UPDATE：
  ```sql
  UPDATE users
  SET email = ?,
      email_normalized = ?,
      email_verified_at = ?
  WHERE id = ? AND email_verified_at = 0
  ```
  其中：
  - `email` 用 KV `pendingEmail`（display form）。
  - `email_normalized` 用 KV `pendingEmailNormalized`。
  - `email_changed_at` **不动**（rev3 decision；保持 0）。
- `WHERE email_verified_at = 0` 仅是单向流程 guard——并发 pending 一致性的真正保证是 KV `pendingEmailNormalized` match；DB UPDATE 这一层只负责单向流程 guard 和触发唯一索引兜底。
- 如果 D1 抛唯一约束冲突（来自 `users_email_normalized_uniq`），catch 后返回 `409 EMAIL_ALREADY_IN_USE`。**最终安全边界仅是 0029 unique partial index，不依赖任何先查；可选预检查只是为了改善错误体验，不构成安全保证。**
- 成功后删除 KV record + 解锁。

Response 200:
```json
{ "verified": true, "verified_at": 1714576800 }
```

Errors（rev3 集合）：
- `400 CODE_FORMAT_INVALID` — code 不是 6 位数字。
- `400 EMAIL_INVALID` — body.email 缺失 / 格式不合法。
- `404 CODE_NOT_FOUND` — KV 无 record（过期 / 从未 request）。
- `403 CODE_INVALID` — code 错；增 attempts；第 5 次后 KV 删除并返回 `403 CODE_LOCKED`。
- `403 EMAIL_ALREADY_VERIFIED`。
- `409 EMAIL_CODE_EMAIL_MISMATCH` — body.email normalize 后 ≠ KV pending。
- `409 EMAIL_ALREADY_IN_USE` — 唯一索引冲突（来自 0029）。

> 旧 §7.1 / §7.2 / §7.3 (rev2) 段落已被本节整体替换。

## 8. Dove Integration

dove exposes:

```
POST /api/webhook/:projectId/send
Authorization: Bearer <project_webhook_token>
Body: { "template": "<slug>", "to": "<email>", "idempotency_key": "<uuid>", "variables": {...} }
```

(Confirmed against `dove/src/server/routes/webhook.ts`.)

### 8.1 Worker-side wiring

- Add three secrets/vars to `apps/worker/wrangler.toml` (development & production):
  - `DOVE_BASE_URL` — e.g. `https://dove.example.com`
  - `DOVE_PROJECT_ID`
  - `DOVE_WEBHOOK_TOKEN` — secret, set via `wrangler secret put`.
- Add a Worker secret `EMAIL_VERIFY_HMAC_KEY` (see §6.2).
- Add a template in dove (out-of-band, manual) with slug `ellie-email-verify` and variables `{ code, expires_in_minutes, username }`.

### 8.1a Recipient whitelist — RESOLVED (Option A) (Rev3)

`dove/src/server/routes/webhook.ts` 历史上对 `to` 做 recipient lookup，缺失则返回 `recipient_not_found`，这与 Ellie 给任意 end-user 邮箱发验证码的需求冲突。

**Decision (resolved 2026-05-02): Option A 已确定并实施 dove 侧代码。**
- per-project flag `projects.allow_unknown_recipients BOOLEAN` 已在 dove 仓库实现 (`eefaf76` / `0adfb4f` / `bc0b2f6`)，flag = true 时跳过 recipient lookup，接受任何 RFC-valid `to`；其他 dove project 默认 `false`、行为不变。
- Ellie project 通过 dove 侧管理界面/SQL 设为 `true`（out-of-band）。
- 配额与 per-project rate limits 仍生效。

**Pending（不再是 design 决策，而是 ops gate）：**
- prod dove 部署 + Ellie project flag 配置 smoke。
- pre-cutover smoke 见 §11.4（rev3 已更新口径——dove 没有独立 staging）。
- Phase 5b worker write-route enforcement 受这两条 ops gate 阻塞；Phase 3b 代码本身不阻塞。

**Option B (fallback)** — 在 dove 侧新增 recipient upsert endpoint，已 rejected（永久膨胀 dove recipients 表，且仍需 dove 改动）。仅作历史记录保留。

### 8.2 Send call

```ts
const idempotencyKey = `${userId}:${codeHmacFirst16}`; // stable per (user, code)
await fetch(`${env.DOVE_BASE_URL}/api/webhook/${env.DOVE_PROJECT_ID}/send`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.DOVE_WEBHOOK_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    template: "ellie-email-verify",
    to: user.email,                // exact display form
    idempotency_key: idempotencyKey,
    variables: {
      code: plaintextCode,
      expires_in_minutes: "15",
      username: user.username,
    },
  }),
});
```

- Timeout: 5s (`AbortSignal.timeout(5000)`). On timeout → `502 EMAIL_PROVIDER_FAILED`.
- Plaintext code is **only** held in memory for the duration of this request. Never logged.
- Idempotency: same code → same key → dove dedupes if we accidentally retry.

## 9. Frontend Changes (`apps/web`) (Rev3)

- New page `/verify-email` (Next.js route)，单流程 UI：
  - 邮箱输入框 + "发送验证码" 按钮（calls §7.2，body `{ email }`）。throttle 期间按钮 disable + 倒计时。
  - 6-digit code 输入框 + 提交（calls §7.3，body `{ email, code }`，复用页面状态里的同一个 email 字段；用户改 email 后必须重发 code）。
  - **不存在「更换邮箱」二级表单**——rev3 单流程下，改邮箱就等于在同一个输入框里换文本然后再点「发送验证码」。
  - §7 错误码全部映射到中文 messages：`EMAIL_INVALID` / `EMAIL_CODE_EMAIL_MISMATCH` / `EMAIL_ALREADY_IN_USE` / `CODE_INVALID` / `CODE_LOCKED` / `CODE_NOT_FOUND` / `CODE_RESEND_THROTTLED` / `EMAIL_PROVIDER_FAILED` / `EMAIL_ALREADY_VERIFIED`。
- Global banner `<UnverifiedEmailBanner>`：当 cached `me` 的 `email_verified_at == 0` 时显示，链接到 `/verify-email`。
- 所有写操作 affordance（发帖 / 回复 / 点评 / 私信 / 上传 / 编辑 / 举报）根据 `me.email_verified_at` 渲染 disabled 状态。Server 仍是 source of truth；UI 只是 convenience。
- Next.js proxy routes（rev3 只有两条）：`/api/v1/users/me/email/request-code`、`/api/v1/users/me/email/verify`。**没有 `/api/v1/users/me/email`**（§7.1 已 removed）。

## 10. Migration & Backfill (Rev3)

Rev3 用一次性 ops 清空替代 rev2 的多步 backfill / dedup gate。

### 10.0 Rev3 ops 清空 (Phase 5a)

1. extractor (`packages/migrate/src/extract/extractors.ts:391`) 已在上游 `87d790e` 把 legacy contact email 丢弃。新导入的 user `email = ''`。
2. 对现存 prod `tongjinet-db` 执行**一次性 ops SQL**（dry-run + apply + verify 三段；同一个 predicate）：
   ```sql
   -- (a) dry-run count，记录到 ops 日志
   SELECT COUNT(*) FROM users
   WHERE email <> '' OR email_normalized <> ''
      OR email_verified_at <> 0 OR email_changed_at <> 0;

   -- (b) apply
   UPDATE users
   SET email = '', email_normalized = '', email_verified_at = 0, email_changed_at = 0
   WHERE email <> '' OR email_normalized <> ''
      OR email_verified_at <> 0 OR email_changed_at <> 0;

   -- (c) verify — 必须返回 0
   SELECT COUNT(*) FROM users
   WHERE email <> '' OR email_normalized <> ''
      OR email_verified_at <> 0 OR email_changed_at <> 0;
   ```
3. **Phase 5a requires explicit ops approval** — 必须由 Codex-02 review 3b commit + 该 SQL 的 dry-run count 后，再由 zheng-li 单独授权 apply。
4. 0028 ALTER TABLE 与 0029 unique partial index 已 apply；clean state 后 partial WHERE 自动跳过空行，无冲突。
5. 旧 `scripts/backfill-email-normalized.ts` / `scripts/find-duplicate-emails.ts` 与对应单测已 drop（rev3 模型下无意义）。

### 10.1 Conditional UPDATE — 单向流程 + 唯一索引兜底 (Rev3)

```sql
UPDATE users
SET email = ?, email_normalized = ?, email_verified_at = ?
WHERE id = ? AND email_verified_at = 0
```

职责划分：
- `WHERE email_verified_at = 0` 仅是**单向流程 guard**（rev3：从未验证 → 已验证 一次性写入），不参与并发安全。
- 并发 pending 一致性由 §7.3 的 `body.email == KV pendingEmailNormalized` 检查保证。
- **email 冲突的最终安全边界仅是 0029 `users_email_normalized_uniq` 唯一索引**，捕获 D1 唯一约束错误并映射为 `409 EMAIL_ALREADY_IN_USE`。可选的应用层预检查只是为了改善错误体验，不构成安全保证。

> 旧 §10 / §10.1 (rev2) 的 backfill / find-duplicate gate 描述已被本节整体替换。

## 11. Testing Plan

### 11.1 Worker unit tests (Vitest) (Rev3)

- `requireVerifiedEmail` middleware: verified passes, unverified → 403, banned still 403 (precedence: ban > unverified).
- `email/request-code` (rev3):
  - body.email 缺失 / 格式不合法 → `400 EMAIL_INVALID`，KV 不写。
  - 成功路径只往 KV 写（含 `pendingEmail` + `pendingEmailNormalized`），**不动 `users` 表**（用 mock D1 spy 验证零写入）。
  - 60s resend throttle、in-flight lock。
  - dove 失败回滚 KV / lock 释放、不烧 throttle。
  - 同一用户连发两次不同 email → 旧 KV record 被覆盖、旧 code 立即失效。
  - 已验证用户调用 → `403 EMAIL_ALREADY_VERIFIED`。
  - 响应 `sent_to` mask 格式正确。
- `email/verify` (rev3):
  - body 必须含 `{ email, code }`；缺 `code` 或非 6 位 → `400 CODE_FORMAT_INVALID`；缺/坏 email → `400 EMAIL_INVALID`。
  - body.email normalize 后 ≠ KV `pendingEmailNormalized` → `409 EMAIL_CODE_EMAIL_MISMATCH`，attempts **不**扣减。
  - 成功路径：写入 `email = KV pendingEmail`（display form）、`email_normalized = KV pendingEmailNormalized`、`email_verified_at = now()`；**`email_changed_at` 未被写入**（mock D1 spy 验证 SET 子句不含该列）。
  - conditional UPDATE 命中 0 行（已被并发验证过） → 视为成功不做事，不二次写。
  - D1 抛 unique 冲突（来自 0029）→ catch 后返回 `409 EMAIL_ALREADY_IN_USE`，KV record 保留，允许用户改邮箱重试。
  - 错 code → attempts 累计；第 5 次后 KV 删除并返回 `403 CODE_LOCKED`。
  - KV 已过期 / 不存在 → `404 CODE_NOT_FOUND`。
  - 已验证用户调用 → `403 EMAIL_ALREADY_VERIFIED`。
- Code generator: distribution sanity (no modulo bias) — statistical test over 100k samples.

> Rev2 的 `EMAIL_CHANGED_SINCE_CODE` / `EMAIL_TAKEN` / `email-change throttle` / `current-email` request-code 测试已被以上 rev3 项替换，对应错误码不再存在。

### 11.2 Worker integration tests

- Drive against in-memory D1 + KV; mock dove via fetch shim.
- Full happy path: register → request-code → verify → POST /threads succeeds.
- Sad paths: unverified user gets 403 EMAIL_NOT_VERIFIED on every blocked endpoint listed in §5.2 (table-driven).

### 11.3 E2E (Playwright, existing harness) (Rev3)

- Login as 邮箱已清空的 seed user → banner 可见 → `/verify-email` 输入 email + 提交 + 输入 code → 后续 POST /threads 成功。
- 邮箱冲突路径：seed 用户 A 已验证 `a@x.io`；seed 用户 B 走流程到 verify 时输入同一 email → 收到 `EMAIL_ALREADY_IN_USE`，重输不同 email 后成功。
- email mismatch 路径：在 `/verify-email` 发完 code 后改 email 再提交 → `EMAIL_CODE_EMAIL_MISMATCH`，提示重发。

### 11.4 Manual smoke (Rev3)

**Controlled pre-cutover smoke against the deployed Dove environment** — Dove 没有独立 staging，必须直接对部署中的 Dove 实例执行；为了把误发风险降到最小，强制约束：

- 仅对 Ellie project 在 dove 侧设置 `allow_unknown_recipients = 1`；其他 project 必须保持 `0`。
- 真实 send 一封到测试邮箱：dove 返回 200、`recipient_not_found = 0`、Ellie worker 拿到 200 后正确写 KV。
- 复核 Ellie worker + dove 双侧日志：**禁止**出现 plaintext code、HMAC、full target email；只允许 userId + masked-email tail。
- smoke 完成后立即在 dove 侧 ops record 中标注「Ellie open-recipients verified at <timestamp>」，作为 Phase 5b cutover 的前置 evidence。

## 12. Rollout (Rev3)

| Phase | Commit subject | Status / Notes |
|---|---|---|
| 1 | `feat(db): add email verification columns (migration 0028)` | **shipped** (commit `0a6641e`). 见 §12.1。 |
| 2 | `feat(worker): requireVerifiedEmail middleware + withVerifiedEmail wrapper (no routes wired)` | **shipped** (commit `59fa4a3`). |
| 3a | `feat(worker): email request-code + verify endpoints (no email-change yet)` + `fix(worker): hide dove upstream code + add per-user in-flight send lock` | **shipped** (commits `064589c`, `3f479a6`). 旧实现：request-code 对 `me.email` 发码、verify 只接受 `{ code }`。在 rev3 模型下 `me.email=''` 是常态，会被 EMAIL_INVALID 拦死，由 Phase 3b 修。 |
| 3b | `feat(worker): request email verification for pending address` | **pending — rev3 new commit**. |
| | | - §7.2 request-code 接收 `body.email`，pending 状态全部存 KV，不写 `users` 表。 |
| | | - §7.3 verify 接收 `{ email, code }`；body.email normalize 后必须 == KV pending（否则 `409 EMAIL_CODE_EMAIL_MISMATCH`）。 |
| | | - verify 成功用条件 UPDATE 写入 email + normalized + verified_at；`email_changed_at` 不动。 |
| | | - 撞 0029 唯一索引 ⇒ catch 后返回 `409 EMAIL_ALREADY_IN_USE`；最终安全边界仅依赖唯一索引。 |
| 4 | `feat(db): unique partial index on email_normalized (migration 0029)` | **shipped** (commit `73be123`). 见旧 §12 4c 的 status 段。 |
| 5a | (ops) clear `email / email_normalized / email_verified_at / email_changed_at` on prod tongjinet-db | **pending — Phase 5a requires explicit ops approval**: Codex-02 review 3b commit + dry-run count 后由 zheng-li 单独授权 apply。SQL 见 §10.0。 |
| 5b | `feat(worker): enforce verification on write routes` | **pending**. 切换 §5.2 各路由到 `requireVerifiedEmail` / `withVerifiedEmail` / 扩展 `moderationMiddleware`。User-visible cutover；上线前 Phase 5a 必须完成。 |
| 6 | `feat(web): /verify-email page + banner + proxy routes` | **pending**. rev3 单流程：单一 email 输入框 + code 输入框；不含「换邮箱」UI。Proxy routes 只需 §7.2 / §7.3 两条。 |
| 7 | `feat(web): disable write affordances when unverified` | **pending**. UX polish。 |

**Removed in rev3：** rev2 §12 中的 4b backfill scripts、原 Phase 5 `feat(worker): email-change endpoint (7.1)`、§6 quota。

### 12.1 Phase 1 — exhaustive file list

Codex-02 flagged that "Phase 1 = migration only" leaves the local DB and the TS layer drifting. Phase 1 must touch every place that knows the `users` shape:

| File | Change |
|---|---|
| `apps/worker/migrations/0028_email_verification_columns.sql` | NEW. The three `ALTER TABLE` statements from §6.1. |
| `packages/db/src/schema.ts` | Add `email_verified_at`, `email_normalized`, `email_changed_at` to the base schema definition so fresh local DBs match production. |
| `packages/types/src/user.ts` (or wherever `User` lives) | Extend the shared `User` type with the three new fields (numbers / string). |
| `packages/repositories/src/users/*.ts` | Extend the user repo's read mappers and any insert/update helpers to round-trip the new fields. |
| `apps/worker/src/handlers/auth.ts` — `USER_COLUMNS` | Add `email_verified_at, email_normalized, email_changed_at`. |
| `apps/worker/src/handlers/me.ts` — `USER_COLUMNS` | Same. (`PUBLIC_USER_COLUMNS` in `user.ts` is **not** modified — public view does not expose verification state.) |
| `apps/worker/src/handlers/admin/user.ts` — `USER_COLUMNS` | Same — admin views the field for support. |
| Any test factory / fixture for `User` (search: `tests/**/factories/user*`, `scripts/seed-test-db.sql`) | Add defaults (`email_verified_at: 0`, `email_normalized: ''`, `email_changed_at: 0`) so existing tests still compile. |
| `scripts/seed-test-db.sql` | Add the three columns to the seed `INSERT`s with default values. |

Auth/me handler returns the new `email_verified_at` so the frontend can render the banner without an extra round trip — that wiring is in phase 7, but the field must be exposed in phase 1 so the frontend has something to read once we get there.

No behavioral code changes in phase 1. Phase 1 is reviewable as "schema + type + accessor exposure only."

## 13. Resolved Reviewer Decisions

(Original §13 questions, closed by Codex-02's review on 2026-05-01. Rev3 amendments inline.)

1. **Masking in request-code response** — keep masked-only (`u***@example.com`). _Rev3 rationale_: 用户在 `/verify-email` 页面刚刚自己输入了 pending email，前端已知该地址（来自表单 state，**不是** `me.email`，rev3 下后者为 `''`）；server mask 只是减少肩窥风险。
2. **`PATCH /api/v1/users/me` for unverified** — **block**. _Rev3_: rev2 的 §7.1 email-change endpoint 已 removed；email 写入只走 §7.2/§7.3 verify 成功路径。Password change (`POST /api/v1/users/me/password`) 仍允许。
3. **Throttle defaults** — keep 60s resend / 5 attempts. _Rev3_: 24h email-change quota 随 §6 quota 一起 removed。Per-IP / per-user send limiting 仍然 deferred。
4. **Mod / admin treatment** — `/api/v1/moderation/*` mods/admins must verify (no exemption). `/api/admin/*` is **out of scope** because it has no end-user JWT to gate on (Key B-only); see §5.2.
5. **Migration ordering** — _Rev3_: rev2 「unique index 必须先于 email-change endpoint」的 ordering 在 rev3 不再相关（§7.1 已 removed）；改为 Phase 5a ops clear 必须先于 Phase 5b write-route enforcement。

Plus the new decision required by this revision:

6. **Dove "open recipients" mode (Option A)** — **resolved 2026-05-02**: Option A 已确定并在 dove 仓库实施 (`eefaf76` / `0adfb4f` / `bc0b2f6`)；剩余仅 ops gate（prod deploy + Ellie project 配置 + §11.4 controlled pre-cutover smoke），不再是 design open question。

## 14. Open Questions for Reviewer (this revision)

(无未决 design 问题。dove Option A 已 resolved，相关 ops gate 列在 §8.1a / §11.4。)

## 15. Rollback (Rev3)

- Phases 1 / 2 / 3a / 4 / 3b — pure additions or backwards-compatible behavior changes; revert the commit, no data cleanup needed.
- Phase 4 (the unique index) is reverted by `DROP INDEX users_email_normalized_uniq`.
- Phase 5a (ops clear) — irreversible; rollback means restoring from D1 snapshot of `tongjinet-db` taken immediately before apply (ops captures snapshot id in apply log).
- Phase 5b (write-route enforcement cutover) is reverted by reverting the single commit; routes go back to `withAuthVerified` / `authMiddlewareVerified` and verification becomes opt-in / no-op.

## 16. Security Notes

- Codes are stored as `HMAC-SHA256(server_secret, "<userId>:<email>:<code>")`. Full KV exfiltration without the secret does **not** allow code recovery; with the secret, an attacker has full forum control anyway.
- HMAC is constant-time-compared.
- Per-user attempt cap (5) prevents online brute force (5 tries × 1M space ≈ 5×10⁻⁶ success per code).
- Resend throttle prevents using the system as a free email blaster.
- (Rev3: rev2 的 email-change throttle 随 §6 quota / §7.1 endpoint 一起 removed。)
- Unique partial index 0029 是邮箱冲突的最终安全边界；应用层 conditional UPDATE 与可选预检查只是为了改善错误体验，不构成安全保证。
- No sensitive data in logs (plaintext code, HMAC, full normalized email are all elided; only userId + masked-email tail is logged).
- Rotating `EMAIL_VERIFY_HMAC_KEY` invalidates all in-flight codes — acceptable as a recovery move.
