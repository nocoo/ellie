# 14a. Audit Logs (Admin Operation Logs)

> Source-of-truth doc for the F batch. Covers schema, write path, action matrix, redaction rules, read API, UI, and test gates. See [`docs/10-admin-console.md`](./10-admin-console.md) §7 for the higher-level admin-console story.

---

## 1. Storage

### 1.1 Schema

```sql
CREATE TABLE IF NOT EXISTS admin_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL,                    -- always 0 today (email-keyed sessions)
  admin_name  TEXT NOT NULL DEFAULT '',            -- header X-Admin-Actor-Name → email → 'system'
  action      TEXT NOT NULL,                       -- e.g. user.ban, forum.reorder, setting.update
  target_type TEXT NOT NULL DEFAULT '',            -- singular noun: user, thread, post, forum, report, setting, ip_ban, censor_word, announcement
  target_id   INTEGER,                             -- nullable for batch / global ops
  details     TEXT NOT NULL DEFAULT '',            -- JSON string, sanitized + capped
  ip          TEXT NOT NULL DEFAULT '',            -- CF-Connecting-IP → first XFF → ''
  created_at  INTEGER NOT NULL                     -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin   ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action  ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target  ON admin_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);
```

Defined in `apps/worker/migrations/0000_init_schema.sql`. No additional migration was needed for F batch — F1 only added the helper around the existing table.

### 1.2 Why `admin_id` is always 0

Admin sessions are keyed by email (NextAuth + `ADMIN_EMAILS` whitelist), not by a numeric `users.id`. Rather than join admin emails to potentially-non-existent forum users, we keep `admin_id = 0` and persist the actual identity via `admin_name` (display) plus `details.actorEmail` (the full address — see §3.3).

---

## 2. Write Path

### 2.1 Actor headers (Next admin proxy → Worker)

The admin proxy wrapper `adminApiAs(actor)` in `apps/admin/src/lib/admin-api.ts` injects two headers on every mutation call:

| Header                  | Source                              | Purpose                       |
|-------------------------|-------------------------------------|-------------------------------|
| `X-Admin-Actor-Email`   | `session.user.email`                | Persisted as `details.actorEmail` and used to derive `admin_name` fallback. |
| `X-Admin-Actor-Name`    | `session.user.name` (or email)      | Stored verbatim in `admin_logs.admin_name`. |

`resolveActor(request)` in `apps/worker/src/lib/adminLog.ts`:

- `adminName` ← `X-Admin-Actor-Name` → `X-Admin-Actor-Email` → `"system"`.
- `adminEmail` ← trimmed `X-Admin-Actor-Email`, or `""`.
- `ip` ← `CF-Connecting-IP` → first segment of `X-Forwarded-For` → `""`.
- `adminId` is hardcoded to `0`.

**Handlers MUST go through `adminApiAs` to get a real actor.** Direct Worker calls authenticated only by Key B carry no headers and are recorded as `system`/`id=0` — that is intentional (e.g. internal background tasks), not a bug.

### 2.2 `writeAdminLog(env, actor, params)`

```ts
await writeAdminLog(env, resolveActor(request), {
  action: "user.ban",
  targetType: "user",
  targetId: userId,
  details: { reason, durationDays },
});
```

Contract:

- **Best-effort.** Catches DB errors and logs them via `console.error("[adminLog] INSERT failed", …)`. **Never re-throws** — a failed audit must not fail the underlying mutation.
- **Validates shape** — empty `action` (>64 chars), empty `targetType` (>32 chars), non-integer `targetId` are rejected up front (logged + returned).
- **Auto-merges `actorEmail`** into `details` when `actor.adminEmail` is non-empty. System actor leaves details alone (no `"actorEmail":""` pollution).
- **Call AFTER the mutation commits.** Failure-path audit (e.g. `user.ban_failed`) is intentionally out of scope — F1 only writes successful events. Add a separate action if/when needed.

### 2.3 Details sanitization (`sanitizeAdminLogDetails`)

| Rule | Behavior |
|------|----------|
| Top-level type | Must be a plain object. Arrays/scalars/`null` collapse to `"{}"`. |
| Redaction | Lower-cased exact-match denylist replaces the value with `"[REDACTED]"` at every depth. |
| Depth cap | `DETAILS_MAX_DEPTH = 4`. Subtrees beyond the cap collapse to `"[DEPTH_LIMIT]"`. |
| Size cap | `DETAILS_MAX_BYTES = 4096` (UTF-8). Oversize payloads are wrapped as `{"truncated":true,"head":"<prefix>"}` where `head` shrinks until the envelope fits. |
| Serialization failure | Returns `"{}"` (e.g. circular refs). |

Denylist (lower-cased exact match): `password`, `passwordhash`, `password_hash`, `token`, `secret`, `apikey`, `api_key`, `api-key`, `cookie`, `authorization`, `email`.

**Important:** The bare key `email` is denied, but compound names like `actorEmail`, `emailNormalized`, `targetEmail` pass through. This is by design — audit consumers need to identify *who* acted and *who* was acted on.

---

## 3. Action Matrix

Action naming convention: **singular `targetType`** + **`.verb`**. Batch operations end in `.batch_<verb>`. Failure-path verbs (`*_failed`) are reserved for future use; no handler emits them today.

| Module       | targetType    | Actions emitted                                                      | Handler file                                |
|--------------|---------------|----------------------------------------------------------------------|---------------------------------------------|
| Users        | `user`        | `user.ban`, `user.unban`, `user.nuke`, `user.purge`                 | `apps/worker/src/handlers/admin/user.ts`   |
| Reports      | `report`      | `report.resolve`, `report.dismiss`, `report.batch_delete`           | `apps/worker/src/handlers/admin/report.ts` |
| Threads      | `thread`      | `thread.update`, `thread.delete`, `thread.batch_delete`, `thread.batch_move` | `apps/worker/src/handlers/admin/thread.ts` |
| Posts        | `post`        | `post.update`, `post.delete`, `post.batch_delete`                   | `apps/worker/src/handlers/admin/post.ts`   |
| Forums       | `forum`       | `forum.create`, `forum.update`, `forum.delete`, `forum.merge`, `forum.reorder` | `apps/worker/src/handlers/admin/forum.ts`  |
| Settings     | `setting`     | `setting.update`                                                     | `apps/worker/src/handlers/admin/settings.ts` |
| IP bans      | `ip_ban`      | `ip_ban.create`, `ip_ban.update`, `ip_ban.delete`, `ip_ban.batch_delete` | `apps/worker/src/handlers/admin/ipBan.ts`  |
| Censor words | `censor_word` | `censor_word.create`, `censor_word.update`, `censor_word.delete`, `censor_word.batch_delete` | `apps/worker/src/handlers/admin/censorWord.ts` |
| Announcements| `announcement`| `announcement.create`, `announcement.update`, `announcement.delete`, `announcement.batch_delete` | `apps/worker/src/handlers/admin/announcement.ts` |
| Attachments  | (n/a)         | **Not yet emitted — tracked as F3-d follow-up.**                    | `apps/worker/src/handlers/admin/attachment.ts` |

`targetId` is `null` for global ops (`forum.reorder`, `setting.update`) and batch ops (`*.batch_*`). Batch ops should still record the affected IDs in `details` (e.g. `details: { ids: [...], count: N }`) so the audit row remains useful.

---

## 4. Read API (F2)

### 4.1 List — `GET /api/admin/admin-logs`

| Query param   | Type    | Meaning |
|---------------|---------|---------|
| `page`        | int     | 1-based page index. Default `1`. |
| `limit`       | int     | Page size. Default `20`. |
| `action`      | string  | Exact match on `admin_logs.action`. |
| `targetType`  | string  | Exact match on `admin_logs.target_type`. |
| `adminId`     | int     | Exact match on `admin_logs.admin_id`. |
| `targetId`    | int     | Exact match on `admin_logs.target_id`. |
| `startDate`   | int     | Unix seconds (inclusive lower bound on `created_at`). |
| `endDate`     | int     | Unix seconds (inclusive upper bound on `created_at`). |

Response is the standard paginated envelope (`{ data, meta: { page, pages, total, limit, timestamp, requestId } }`). Newest first (`ORDER BY created_at DESC`).

### 4.2 Single — `GET /api/admin/admin-logs/:id`

Returns one row by `id`, or 404. The F4 UI does **not** call this endpoint — it opens the dialog with the row data already loaded by the list query, to keep the dependency graph minimal.

---

## 5. Admin UI (F4)

### 5.1 Page

`apps/admin/src/app/(admin)/admin/logs/operations/page.tsx` — read-only list with filters and a detail dialog.

| Concern                | Decision |
|------------------------|----------|
| Mutations              | None. No batch bar, no row selection. |
| Action filter          | Inline controlled `<form>` (Enter to submit, × to clear). Does **not** route through `AdminFilters` — that helper hardcodes its `search` filter to write `filters.search`, ignoring `filter.key`. |
| Target type filter     | `AdminFilters` select — single consumer, hardcoded `"全部 targetType"` placeholder. |
| Other filters          | Inline `<input>`s for adminId / targetId / startDate / endDate. `dateInputToUnix(value, "start"\|"end")` converts `<input type="date">` to local-day boundaries (00:00:00 / 23:59:59). |
| Target column          | Whitelist links: `user → /admin/users/{id}`, `thread → /admin/threads/{id}`, `report → /admin/reports?id={id}`, `forum → /admin/forums`. Other types render as plain text. |
| Details column         | Truncated to 80 chars; click opens `AdminLogDetailDialog`. |
| Detail dialog          | `<pre>` with `whitespace-pre-wrap break-words`. JSON pretty-printed via `JSON.stringify(value, null, 2)`. Parse failure shows the raw text plus an amber `(原始文本，非 JSON)` annotation. Empty payload renders as `(无)`. Only action: 关闭. |

Nav entry lives under the **日志** group in `apps/admin/src/lib/navigation.ts` (`/admin/logs/operations` → 操作日志).

### 5.2 Viewmodel

`apps/admin/src/viewmodels/admin/admin-logs.ts` — pure helpers, no React:

- `buildAdminLogSearchParams(filters)` — assembles the `?…` query, dropping empty strings.
- `parseDetails(raw)` — `{ ok:true, value:unknown }` on success, `{ ok:false, raw:string }` on parse failure or null/empty input.
- `targetHref(type, id)` — whitelist or `null`.
- `formatTarget(type, id)` — `"type#id"` or just `"type"` when id is null.
- `formatLogTime(unix)` — locale string; empty for `0`.
- `dateInputToUnix(value, bound)` — see §5.1.

---

## 6. Test Gates

| Layer | Coverage | Files |
|-------|----------|-------|
| L1 unit (worker lib) | `writeAdminLog` shape validation, `sanitizeAdminLogDetails` redaction/depth/size, `resolveActor` precedence | `apps/worker/tests/unit/lib/adminLog.test.ts` |
| L1 unit (worker handlers) | Per-handler assertions that successful mutations call `writeAdminLog` with the expected `action` / `targetType` / `targetId` / `details` shape | `apps/worker/tests/unit/handlers/admin/*.test.ts` |
| L1 unit (admin viewmodel) | `buildAdminLogSearchParams`, `parseDetails`, `targetHref`, `formatTarget`, `formatLogTime`, `dateInputToUnix` | `apps/admin/tests/unit/viewmodels/admin/admin-logs.test.ts` |
| L2 integration (representative chains) | End-to-end Worker chains that exercise the audit write through the real DB. Covers a representative slice (e.g. `user.ban`, `report.resolve`, `thread.update`, `ip_ban.create` + `ip_ban.delete`) — not every action has a dedicated L2 case. | `tests/integration/worker/admin.test.ts` |
| L3 e2e (admin UI smoke) | List renders columns, action filter forwards `?action=…`, JSON details pretty-print, non-JSON details fall back to raw text. Mock-only (no Worker round-trip). | `tests/e2e/admin/admin-logs.spec.ts` |

Conventions:

- L2 tests **do not** assert on `actorEmail` from `system` actor (it's omitted) — only when the test sets `X-Admin-Actor-Email` headers via `adminApiAs`.
- L2 tests assert details payload **after** sanitization (so any sensitive field added later that lands in the denylist will read `[REDACTED]`).
- E2E spec mocks only `**/api/admin/admin-logs**`. The detail dialog reads row data from state, so `/admin-logs/:id` does **not** need a mock.

Run gates locally:

```bash
# L1 worker lib
bunx vitest --project worker run apps/worker/tests/unit/lib/adminLog.test.ts

# L1 admin viewmodel
bunx vitest --project admin  run apps/admin/tests/unit/viewmodels/admin/admin-logs.test.ts

# L3 e2e — preferred: the runner loads .env.test, sets NODE_ENV=test, boots
# the admin app on :7032, and tears it down. The runner does NOT forward
# extra Playwright args today, so this runs the full admin project.
bun run test:e2e:admin

# Direct invocation only works when you've already loaded .env.test and
# exported NODE_ENV=test, and have an admin server up on :7032 — otherwise
# the loginAsAdmin fixture will refuse to mint a session cookie.
NODE_ENV=test bunx playwright test --project=admin tests/e2e/admin/admin-logs.spec.ts
```

---

## 7. Open Follow-ups

- **F3-d — attachment delete audit.** R2 object delete + DB row delete need a single composite action (`attachment.delete` / `attachment.batch_delete`) with `details` carrying R2 key, byte size, and origin (post id / thread id). Not yet emitted.
- **Failure-path audit.** No handler currently records `*_failed` events. If we add this later, keep it as a separate action so consumers can filter on success vs failure cleanly.
- **Per-row export.** The current UI exposes filters but no CSV export. Out of scope until there's a concrete consumer.
