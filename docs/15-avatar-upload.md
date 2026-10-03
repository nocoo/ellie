# 15. Avatar Upload

## Identity and storage

`users.avatar_path` is the sole avatar identity. A nonempty value is an explicit
R2 key; an empty string means no avatar. The obsolete `avatar` and `has_avatar`
columns are removed by migration 0057. No request derives a key from a UID,
consults a presence flag, or probes object existence.

New uploads use `avatars/{uuid}.{ext}` with immutable cache metadata. Existing
images retain their actual keys, including verified `avatar/...` keys. Their
ownership was resolved by the [one-time inventory](38-avatar-inventory-assessment.md)
and [normalization](37-avatar-path-normalization.md), not a runtime legacy branch.

## Rendering

Worker responses carry required explicit paths for users, posts, comments,
thread authors/last posters, forum last posters, message senders/receivers, and
session/bootstrap users. Existing joins and batched profile hydration supply them.
Anonymous and deleted identities remain masked.

Web and Admin use the explicit CDN path or their local `/default-avatar.gif`.
The `/api/avatar/{uid}` image proxy and Worker avatar-path endpoint are removed.
Unexpected image transport failure can display the local default without a retry
chain; it does not change persisted identity. A missing DTO path is a contract
error, not permission to invent a URL.

## Upload and mutation

The forum accepts JPEG/PNG originals up to 5 MB. Its upload proxy normalizes the
image to JPEG before Worker submission. Worker validates the bytes against its
200 KB limit, writes a unique object first, then saves `avatar_path`. It returns
success only after the mapping write succeeds and invalidates user display caches.
AvatarContext displays the returned unique URL immediately.

Admin no longer exposes a free-text avatar key editor. Generic user/profile edits
cannot assign arbitrary object paths. User purge clears the mapping and does not
delete an object still referenced by another user; the reference lookup uses the
partial `idx_users_avatar_path` index.

## Permissions and imports

When posting restrictions require an avatar, eligibility is `avatar_path != ''`.
Admin presence filtering derives from exactly the same state, without a persisted
boolean or a legacy OR condition. Other account and forum checks still apply.

New imported users have no avatar unless an explicit verified mapping is supplied
by the one-time migration process. Re-imports preserve application-owned paths.
Historical avatar flags and computed keys are not an alternative source of truth.

## Cutover safety

Migration 0057 follows the verified path backfill and drops both obsolete columns.
Avatar-bearing cache payloads and signed reading snapshots change version without
clearing sessions. Web/Admin processes restart on deployment.

`DEPLOYMENT_FREEZE=true` blocks Worker requests before authorization/maintenance
exceptions and suppresses scheduled work. Only GET `/api/live` and the existing
authenticated statistics snapshot read remain available for deployment checks.
It is a deployment safety control, not an avatar fallback. The controlled migration
uses this fence and a D1 recovery bookmark before any destructive schema change.

Use the maintained migration-first `bun run worker:deploy` workflow. Never apply
0057 to live traffic while old readers/writers still reference the removed columns.
