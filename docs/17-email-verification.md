# 17 — Email Verification & Read-Only Gate

Status: **Revision 2 (awaiting Codex-02 re-review)**
Owner: Claude-02 (impl) · Codex-02 (review)
Related: `04g-user-auth.md`, `api-architecture.md`, dove webhook (`POST /api/webhook/:projectId/send`)

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

## 4. User Flow

1. User logs in (or registers). JWT is issued as today.
2. If `email_verified_at <= 0`, the frontend shows a persistent banner: *"请验证邮箱后才能发帖、回帖、评分等操作。"* and routes attempts to write to `/verify-email`.
3. On `/verify-email` the user sees their current email and two actions:
   - **Send code** to current email.
   - **Change email** (if quota allows) → enter new address → server records the change attempt → code is sent to the new address.
4. User enters the 6-digit code. On success → `email_verified_at = now()`, JWT remains valid, banner disappears, write endpoints unlock immediately on next request.
5. If quota for email change is exhausted, the change form is disabled with the next-allowed timestamp shown. "Send code" to the existing email is always allowed (subject to resend throttle).

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
| **Change own email (quota'd)** | `POST /api/v1/users/me/email` *(new)* |
| **Request verification code** | `POST /api/v1/users/me/email/request-code` *(new)* |
| **Submit verification code** | `POST /api/v1/users/me/email/verify` *(new)* |
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

### 6.1 `users` table (additive only)

```sql
ALTER TABLE users ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0;
-- 0 means "not verified". Unix seconds when verified.
ALTER TABLE users ADD COLUMN email_normalized TEXT NOT NULL DEFAULT '';
-- Lowercased + trimmed snapshot of email. Maintained by application layer
-- on every email write. Used for uniqueness checks. Not enforced by DB until
-- backfill completes (see §10), then we add a UNIQUE index.
ALTER TABLE users ADD COLUMN email_changed_at INTEGER NOT NULL DEFAULT 0;
-- Unix seconds of the last successful email change while unverified.
-- Drives the "1 change per 24h" quota.
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

## 7. New API Endpoints

All three live under `/api/v1/users/me/email*`. All require valid JWT (`authMiddlewareVerified`) but **not** verified status.

### 7.1 `POST /api/v1/users/me/email`

Change pending email (only allowed when current user is unverified).

Request:
```json
{ "email": "user@example.com" }
```

Response 200:
```json
{ "email": "user@example.com", "next_change_allowed_at": 1714579200 }
```

Errors:
- `400 EMAIL_INVALID` — fails RFC-style validation (Worker uses a small regex + length cap 254).
- `409 EMAIL_TAKEN` — another user already has this `email_normalized`.
- `429 EMAIL_CHANGE_THROTTLED` — `now < email_changed_at + 86400`. Body includes `next_change_allowed_at`.
- `403 EMAIL_ALREADY_VERIFIED` — endpoint refuses to operate on already-verified accounts (those go through a future flow).

Side effects on success:
- `users.email = <as typed>`, `email_normalized = <lower(trim)>`, `email_changed_at = now()`.
- Any existing KV verification code for this user is **deleted** (changing email invalidates an outstanding code).

### 7.2 `POST /api/v1/users/me/email/request-code`

Generate a code and send via dove.

Request: empty body.

Response 200:
```json
{ "sent_to": "u***@example.com", "expires_in": 900, "next_resend_allowed_at": 1714576800 }
```

Errors:
- `403 EMAIL_ALREADY_VERIFIED`
- `429 CODE_RESEND_THROTTLED` — `now < last_sent_at + 60` (resend throttle = 60s).
- `502 EMAIL_PROVIDER_FAILED` — dove returned 4xx/5xx; no KV state is mutated when delivery fails (so the user can retry without burning the throttle).
- `400 EMAIL_INVALID` — current `email_normalized` is empty / malformed (legacy data — user must call 7.1 first).

Behavior:
- Generate 6-digit code via `crypto.getRandomValues` (uniform, no modulo bias — sample `Uint32` and reject ≥ floor(2^32 / 1_000_000) * 1_000_000).
- Compute `HMAC-SHA256(EMAIL_VERIFY_HMAC_KEY, "<userId>:<email_normalized>:<code>")` and store in KV with TTL 900s and `attempts = 0`.
- Call dove (§8). Only on **success** persist `last_sent_at` and KV entry.
- Mask the address in the response (`u***@example.com`) — never echo the full address back here, to reduce shoulder-surfing leakage in shared environments.

### 7.3 `POST /api/v1/users/me/email/verify`

Submit the code.

Request:
```json
{ "code": "123456" }
```

Response 200:
```json
{ "verified": true, "verified_at": 1714576800 }
```

Errors:
- `400 CODE_FORMAT_INVALID` — not 6 digits.
- `404 CODE_NOT_FOUND` — no live code in KV (expired or never requested).
- `409 EMAIL_CHANGED_SINCE_CODE` — `target_email_normalized` no longer matches current `email_normalized`.
- `403 CODE_INVALID` — wrong code; increments `attempts`. After 5 attempts → KV entry deleted, returns `403 CODE_LOCKED` on the offending request.
- `403 EMAIL_ALREADY_VERIFIED`

Behavior:
- Recompute `HMAC-SHA256(EMAIL_VERIFY_HMAC_KEY, "<userId>:<target_email_normalized>:<submitted>")`.
- Constant-time compare against stored `code_hmac`.
- On success: `users.email_verified_at = now()`, delete KV entry. Existing JWT is unchanged — no logout needed.

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

### 8.1a Recipient whitelist — REQUIRES dove change

`dove/src/server/routes/webhook.ts` currently looks up `to` in the project's recipient table and returns `recipient_not_found` if absent. That makes the current dove API unusable for sending verification mail to **arbitrary** end-user addresses, which is the entire point of the flow.

We have to resolve this before phase 4 ships. Two options, listed in order of preference:

**Option A (preferred): per-project "open recipients" mode in dove.**
Add a project-level flag (e.g. `projects.allow_unknown_recipients BOOLEAN`) that, when true, skips the recipient lookup and accepts any RFC-valid `to`. Quota and per-project rate limits still apply. The Ellie project is set to `true` out-of-band; other dove projects are unaffected (default `false`).

This is a **dove-side change** and is owned by the same author, but is tracked as a **separate PR in the dove repo** and must merge + deploy before Ellie phase 4. It is on the critical path; this RFC explicitly depends on it.

**Option B (fallback): Ellie auto-registers recipients.**
On `POST /api/v1/users/me/email/request-code`, Ellie calls a new dove endpoint `POST /api/webhook/:projectId/recipients` (also doesn't exist today) to upsert the recipient before sending. Same problem: requires a dove change. Plus it permanently bloats the dove recipients table with one row per Ellie user. Rejected unless Option A is infeasible.

**Decision required from reviewer:** confirm Option A. The rest of this RFC assumes A.

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

## 9. Frontend Changes (`apps/web`)

- New page `/verify-email` (Next.js route) with:
  - Current email + masked preview.
  - "发送验证码" button (calls 7.2) with disabled state + countdown when throttled.
  - 6-digit code input + submit (calls 7.3).
  - "更换邮箱" form (calls 7.1) with disabled state + "下次可更换时间".
  - All error codes from §7 mapped to user-facing 中文 messages.
- Global banner `<UnverifiedEmailBanner>`: shows when the cached `me` response has `email_verified_at = 0`. Links to `/verify-email`.
- All write affordances (发帖按钮 / 回复框 / 点评 / 私信 / 上传 / 编辑 / 举报) check `me.email_verified_at` and render a disabled state with the same banner copy when unverified. Server still enforces — UI is convenience.
- Add a Next.js proxy route per §CLAUDE.md rule for each of the three new endpoints: `/api/v1/users/me/email`, `/api/v1/users/me/email/request-code`, `/api/v1/users/me/email/verify`.

## 10. Migration & Backfill

Existing rows have `email_verified_at = 0` (sentinel). Decision matrix for the launch moment:

| Existing user state | Treatment |
|---|---|
| Has a non-empty plausible email (regex match) | `email_verified_at` stays at `0` (must verify on next write attempt). They keep read-only access but cannot post until they verify. |
| `email = ''` or fails regex | Same: must verify, but they will need to use 7.1 first to set a real email. |
| Admin / SuperMod / Mod accounts | Same gate — no role bypass. (We notify mods out-of-band before launch so they verify first.) |

### 10.1 Strict ordering — uniqueness must be enforced before email-change is exposed

The previous draft deferred the unique index to the end. Codex-02 correctly flagged this: between `POST /api/v1/users/me/email` going live and the unique index landing, two concurrent change requests can both pass an application-layer "is this email_normalized free?" check and both succeed. With Cloudflare D1's single-region serialization this window is short but non-zero, and behavior under future read replicas is undefined. We fix the ordering instead of relying on luck.

Hard ordering:

1. Migration `0028_email_verification_columns.sql` — adds `email_verified_at`, `email_normalized`, `email_changed_at` (defaults make this safe mid-traffic).
2. Backfill script `scripts/backfill-email-normalized.ts` — populates `email_normalized = lower(trim(email))` for all rows where it is empty. Idempotent, safe to re-run.
3. **Duplicate resolution gate.** Run `scripts/find-duplicate-emails.ts`. If any duplicates exist, ops manually picks the canonical owner (oldest `reg_date`, ties broken by lowest `id`) and clears `email_normalized` to `''` on the others — those users will be forced through 7.1. **Phase 4 cannot ship until this script reports zero duplicates.**
4. Migration `0029_email_normalized_unique_index.sql` — `CREATE UNIQUE INDEX users_email_normalized_uniq ON users(email_normalized) WHERE email_normalized != '';` (D1 supports partial indexes via SQLite). The `WHERE` clause leaves rows with empty `email_normalized` (legacy / cleared duplicates) un-constrained until they set a real email.
5. **Then and only then** is `POST /api/v1/users/me/email` allowed to ship (phase 5 in §12).

The application layer additionally runs:

```sql
UPDATE users
SET email = ?, email_normalized = ?, email_changed_at = strftime('%s','now')
WHERE id = ?
  AND NOT EXISTS (SELECT 1 FROM users WHERE email_normalized = ? AND id != ?)
```

inside a transaction. The unique index is the real safety net; the conditional UPDATE keeps error surface clean (no constraint-violation 500s — we catch the no-op and return `409 EMAIL_TAKEN`).

## 11. Testing Plan

### 11.1 Worker unit tests (Vitest)

- `requireVerifiedEmail` middleware: verified passes, unverified → 403, banned still 403 (precedence: ban > unverified).
- `email/request-code`: throttle, dove failure rolls back KV write, mask format.
- `email/verify`: success, wrong code increments attempts, 5th wrong → CODE_LOCKED, expired → CODE_NOT_FOUND, EMAIL_CHANGED_SINCE_CODE.
- `email`: throttle, EMAIL_TAKEN, EMAIL_INVALID, invalidates outstanding KV code.
- Code generator: distribution sanity (no modulo bias) — statistical test over 100k samples.

### 11.2 Worker integration tests

- Drive against in-memory D1 + KV; mock dove via fetch shim.
- Full happy path: register → request-code → verify → POST /threads succeeds.
- Sad paths: unverified user gets 403 EMAIL_NOT_VERIFIED on every blocked endpoint listed in §5.2 (table-driven).

### 11.3 E2E (Playwright, existing harness)

- Login as unverified seed user → verify email banner is visible → /verify-email flow → posting succeeds afterward.
- Email change throttle: change once, second change within 24h is rejected with the right message.

### 11.4 Manual smoke

- One real send through dove staging to confirm template renders.

## 12. Rollout

Phased atomic commits, each independently revertable. **No commit lands until §13 review approves the corresponding phase.**

| Phase | Commit subject | Notes |
|---|---|---|
| 1 | `feat(db): add email verification columns (migration 0028)` | See §12.1 for full file list — migration + base schema + types + repos + USER_COLUMNS + mocks. No behavior change. |
| 2 | `feat(worker): requireVerifiedEmail middleware + withVerifiedEmail wrapper (no routes wired)` | Middleware + unit tests; not yet enforced. Includes `EMAIL_VERIFY_HMAC_KEY` Worker secret wiring. |
| 3 | `feat(worker): email request-code + verify endpoints (no email-change yet)` | Implements 7.2 and 7.3 only. Email-change (7.1) is **not** shipped here because it depends on the unique index landing first. **Implementable in code, but not user-visible until phase 4a (dove open-recipient) ships** — the request-code path will fail on real recipients otherwise. |
| 4a | (out-of-repo) **dove**: per-project `allow_unknown_recipients` flag + Ellie project enabled + staging smoke hard gate | Owned by same author, separate dove PR. **Phase 5 and all later phases blocked** until: (1) dove deployed with the flag on for Ellie project, (2) staging smoke send succeeds with `recipient_not_found = 0`, (3) error logs verified to contain no plaintext code / HMAC / full email. |
| 4b | `chore(scripts): backfill-email-normalized + find-duplicate-emails` | Tooling only. Run in ops; resolve duplicates. _Note: superseded by simplified model (rev3) — all user emails will be cleared, so backfill/dedup is moot. Scripts dropped from history._ |
| 4c | `feat(db): unique partial index on email_normalized (migration 0029)` | Lands only after 4b reports zero duplicates. **Status (Phase 4c shipped):** migration `apps/worker/migrations/0029_email_normalized_unique_index.sql` adds `CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uniq ON users(email_normalized) WHERE email_normalized != ''`, mirrored in `packages/db/src/schema.ts` for fresh-DB bootstrap. Drift guard at `tests/unit/migration-0029-schema.test.ts` pins index name + table + partial WHERE in BOTH sources. Production 4b ops gate against `tongjinet-db` snapshot completed 2026-05-02 with analyzer exit=0 / Zero duplicate groups. |
| 5 | `feat(worker): email-change endpoint (7.1) using transactional uniqueness` | Now safe to expose. Includes the conditional-UPDATE pattern from §10.1. |
| 6 | `feat(worker): enforce verification on write routes` | Switch each route in §5.2 to `requireVerifiedEmail` / `withVerifiedEmail` / extended `moderationMiddleware`. User-visible cutover. |
| 7 | `feat(web): /verify-email page + banner + proxy routes` | Frontend; ships after backend cutover. |
| 8 | `feat(web): disable write affordances when unverified` | UX polish. |

Each commit:
- Passes `bun run typecheck`, `bun run lint`, `bun run test`.
- Includes targeted tests where applicable.
- Has a body that names the RFC: `Refs docs/17-email-verification.md`.

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

(Original §13 questions, closed by Codex-02's review on 2026-05-01.)

1. **Masking in request-code response** — keep masked-only (`u***@example.com`). The `/verify-email` page already knows the current address from `GET /api/v1/auth/me`, so masking the send response loses no usability.
2. **`PATCH /api/v1/users/me` for unverified** — **block**. Email continues to go through the dedicated 7.1 endpoint. Password change (`POST /api/v1/users/me/password`) remains allowed.
3. **Throttle defaults** — keep 60s resend / 24h email-change / 5 attempts. Per-IP / per-user send limiting is **deferred** (separate RFC if abuse appears in logs after launch).
4. **Mod / admin treatment** — `/api/v1/moderation/*` mods/admins must verify (no exemption). `/api/admin/*` is **out of scope** because it has no end-user JWT to gate on (Key B-only); see §5.2.
5. **Migration ordering** — unique index (`0029`) must land **before** the email-change endpoint is exposed to users. See §10.1 and the revised §12 phase order.

Plus the new decision required by this revision:

6. **Dove "open recipients" mode (Option A)** — confirm the dove-side change in §8.1a is the chosen path. Phase 5 here is blocked on it.

## 14. Open Questions for Reviewer (this revision)

- §8.1a Option A vs B — please explicitly confirm A so the dove PR can start.
- Anything else that should now be a hard test gate (e.g. require zero `recipient_not_found` from dove staging during phase 4 smoke before phase 5 cutover)?

## 15. Rollback

- Phases 1–3 are pure additions; revert the commit, no data cleanup needed.
- Phase 4c (the unique index) is reverted by `DROP INDEX users_email_normalized_uniq`.
- Phase 5 (email-change endpoint) — revert removes the route; existing data is fine.
- Phase 6 (the cutover) is reverted by reverting the single commit; routes go back to `withAuthVerified` / `authMiddlewareVerified` and verification becomes opt-in / no-op.

## 16. Security Notes

- Codes are stored as `HMAC-SHA256(server_secret, "<userId>:<email>:<code>")`. Full KV exfiltration without the secret does **not** allow code recovery; with the secret, an attacker has full forum control anyway.
- HMAC is constant-time-compared.
- Per-user attempt cap (5) prevents online brute force (5 tries × 1M space ≈ 5×10⁻⁶ success per code).
- Resend throttle prevents using the system as a free email blaster.
- Email change throttle prevents bypass-by-rapid-rotation.
- Unique partial index is the authoritative protection against email collision; the application-layer conditional UPDATE is for clean error surface only.
- No sensitive data in logs (plaintext code, HMAC, full normalized email are all elided; only userId + masked-email tail is logged).
- Rotating `EMAIL_VERIFY_HMAC_KEY` invalidates all in-flight codes — acceptable as a recovery move.
