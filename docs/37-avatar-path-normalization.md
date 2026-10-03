# 37. Avatar Path Normalization

Status: implementation authorized on 2026-10-03, including one-time backfill,
legacy-field removal, and explicit Z+1 release (1.14.20). The owner selected no
avatar for all six smaller-only cases. Production cutover remains gated on passing
validation and a proven write fence; execution receipts follow completion.

Completed: [v1.14.20](https://github.com/nocoo/ellie/releases/tag/v1.14.20), release
commit `74ab19dea34649408c62522885201aeb8a7ffaf7`. The complete 151,360-row backfill
was read back exactly; migration 0057 is applied; Web/Admin/Worker report 1.14.20;
the deployment fence is removed. See [execution receipts](38-avatar-inventory-assessment.md#production-execution).

## Objective

Resolve avatar ownership and object existence once, then remove runtime guessing.
`users.avatar_path` becomes the only persisted avatar identity:

- A nonempty value is an explicit, validated R2 object key.
- An empty value means no avatar; render the default image immediately.
- A missing field is an incomplete payload, not evidence that an avatar is absent.

Remove `users.has_avatar`, the obsolete `users.avatar` field, their public DTO
fields, and UID-derived avatar fallback logic. Do not replace them with another
presence flag, a negative-cache database, or dual-read compatibility code.
Posting eligibility and administrative avatar filters derive from `avatar_path`.

## Evidence and current failure

The 2026-09-19 through 2026-10-02 UTC investigation found 106,019 R2 404 operations
out of 123,825 operations. The largest missing-object groups were legacy avatar
keys. Separately, CDN analytics counted 228,851 HTTP 404 responses on
`t.no.mt/avatar/*`; 139,241 carried `User-Agent: Ellie/1.0`, matching the Next.js
avatar proxy. These sampled datasets describe different layers, not an exact
cache-hit calculation. Referer access returned 403.

Relevant code paths:

| Location | Current problem / required change |
| --- | --- |
| `apps/web/src/lib/avatar.ts`, `avatar-proxy.ts` | Empty paths generate a guessed legacy key; remove that interpretation. |
| `apps/web/src/app/api/avatar/[uid]/route.ts` | Unknown paths invoke Worker, probe CDN, then fetch a default image on failure. Remove this image-proxy route after callers receive explicit paths. |
| `apps/web/src/contexts/avatar-context.tsx`, `components/forum/user-avatar.tsx` | Propagate explicit paths; preserve immediate upload updates without UID probing. |
| `apps/admin/src/lib/cdn.ts`, `components/admin/user-avatar.tsx` | Admin repeats the same legacy fallback; use the same path-only contract. |
| `apps/worker/src/lib/cache/user-read.ts`, `user-cache.ts`, `mappers.ts` | Public/private/mini users and avatar-only payloads need consistent semantics; remove the avatar-only route/cache when unused. |
| `apps/worker/src/handlers/thread.ts` | Some intermediate fast-path mappings deliberately blank avatar fields. Trace final hydration; unknown values must not silently become authoritative empty paths. |
| `apps/worker/src/lib/postingPermission.ts` | Remove `has_avatar` reads and OR conditions. |
| `apps/worker/src/handlers/admin/user.ts` | Replace compound presence filters and unrestricted avatar-path text mutation. |
| `apps/worker/src/lib/upload.ts`, `userTombstone.ts` | Upload writes only `avatar_path`; tombstones clear it without restoring historical objects. |
| `packages/migrate/src`, `scripts/migrate` | Historical importers emit avatar flags/guessed paths and must not reintroduce them. |
| `packages/types/src`, `packages/cli-rs`, legacy TS CLI | Remove obsolete avatar fields and update actual consumers, fixtures, and generated declarations. |

An empty GUID path is not proof of an absent legacy object. Conversely,
`has_avatar = 1` is not proof that the object exists. Neither is authoritative for
the migration. Existing documentation also describes different historical key
layouts; do not choose one by assumption.

## Proposed decisions for review

1. Preserve verified objects at their existing keys. A stored `avatar/...` key is
   ordinary data, not a legacy runtime branch. No bulk rename/copy, metadata rewrite,
   orphan deletion, or placeholder-object creation is necessary to meet the goal.
   Converting all objects to GUID names would be a separate physical-storage project.
2. Perform one bounded, resumable migration campaign followed by one coordinated
   cutover, not an online compatibility rollout. There is no request-time discovery.
3. Use an approved maintenance window with a verified full application write fence.
   Existing maintenance mode alone is insufficient: admin/auth exceptions and a
   five-minute settings cache remain. Freeze external importers and direct writers,
   drain in-flight requests, and account for scheduled/background work as well.
4. A verified missing object means no usable avatar, including for posting rules.
   Users whose stale flag previously granted permission may need to upload an image.
   Report the affected count before approval; never grandfather the obsolete flag.

The owner authorized implementation, database cutover and release after the
assessment. Six smaller-only users are intentionally avatar-less; the nonnegative
status avatar-gate loss is therefore 69 users, not 66. Do not substitute a dual-model
rollout. Keep the write fence closed until the coordinated deployment is verified.

## One-time inventory and mapping

### 1. Capture bounded source inventories

- Use `cf` command discovery and schema inspection for authenticated operations;
  never print credentials or copy unrelated account resources.
- Read `tongjinet` object metadata with `cf r2 objects list`, following every cursor
  to completion. List the bucket once to capture known and unexpected historical
  prefixes; do not issue a CDN/HEAD request for every user. The last observation
  was 622,696 objects, so record actual page count and operation cost.
- Read only needed D1 columns in primary-key pages: ID, current avatar fields,
  and tombstone/deletion status. Do not export passwords, sessions, or contact data.
  Do not scan posts or threads to infer avatar existence.
- Store inventories, cursor checkpoints, source identifiers, timestamps, row counts,
  and checksums in a restricted, ignored local run directory. Use local SQLite to
  join the inventories; do not create persistent production mapping infrastructure.
- Failed pages, repeated cursors, incomplete listings, inaccessible objects, and
  invalid ownership mappings fail the inventory. A timeout/403/429/5xx is never
  classified as object absence. Retry bounded transient failures or stop.

### 2. Produce a deterministic manifest

Each manifest record includes user ID, expected old path, resolved new path,
classification, and matching object evidence (key, size, ETag where available).
Keep provenance of each historical ownership mapping in the run artifact.

| Input state | Resolution |
| --- | --- |
| Tombstoned user | Empty; never rediscover and expose a deleted user's old image. |
| Existing nonempty path with a valid matching object | Preserve the exact key. |
| Existing nonempty path absent from a complete inventory | Report as broken current mapping; resolve to empty, not an older avatar. |
| Empty path with one unambiguous, valid user-owned historical object | Store its actual key, regardless of the old flag. |
| Empty path without a matching object | Empty, regardless of the old flag. |
| Multiple candidate identities, unsupported layouts, invalid keys, or conflicting ownership | Unresolved; block application until explicitly resolved. |

Multiple size variants are not multiple identities: choose the documented full-size
variant only when the actual key layout proves the same ownership. Per the owner,
the six known smaller-only cases resolve to empty, without runtime size fallback. Do not choose
arbitrarily between unrelated candidate files. Existing nonempty paths always take
precedence; do not resurrect an older avatar when the current image is missing.

Validate that selected objects are nonempty images with acceptable metadata and
safe relative keys. Where metadata is insufficient, inspect only the ambiguous
candidate objects, outside the request path; unresolved validation blocks cutover.
Do not rely on `has_avatar`, CDN negative caches, or a syntactically plausible key.

Manifest accounting must cover every eligible user exactly once and distinguish
preserved, backfilled, empty, broken-current, tombstoned, and unresolved records.
Report users whose effective posting eligibility changes, both directions.

### 3. Finalize and apply under the write fence

The initial inventory is a preflight, not an atomic D1/R2 snapshot. After the fence
is proven, refresh inventories and reconcile changes before applying anything.
No uploads, deletions, imports, admin edits, or storage lifecycle changes may alter
the relevant data until validation and cutover finish. If this cannot be proven,
stop rather than guess that the earlier manifest is still current.

Apply changed rows only, using bounded primary-key batches and expected-old-value
conditions. Preserve current GUID paths; mismatches fail the batch and require
reconciliation. Record successful batches and verify final values on resume, since
the campaign cannot be one cross-service transaction. A resumed completed batch
must not generate duplicate writes. Match pre/post counts and re-export the narrow
user projection to verify every manifest result.

No R2 objects are changed or deleted by this migration. Review object retention
rules so newly explicit references cannot point into a prefix scheduled for removal.

## Runtime and schema simplification

### Read paths

- Return `avatarPath` explicitly in every avatar-bearing payload: users, session
  identity, forum last posters, thread authors/last posters, post authors, comments,
  private-message peers/senders, profile and admin lists/details.
- Reuse existing joins, batched mini-user hydration, and bounded snapshots. No
  per-avatar D1 lookup, no new KV requests, and no R2 existence check on reads.
- Make avatar-bearing DTO fields required. A deliberately anonymous/deleted user
  has an empty path; an omitted field fails payload validation instead of guessing.
- Remove `/api/avatar/[uid]`, its callers, the dedicated Worker avatar-path endpoint,
  and the `user:avatar-path` cache family once their references are eliminated.
  Remove only their matching obsolete edge-rule branch, preserving unrelated rules.
- Use one repository-owned static default image in Web/Admin, not another R2 fetch.
  Keep a bounded UI error fallback for unexpected corruption/outages, without retries
  or mutation of stored state. Empty paths must never initiate an avatar object request.
- Keep GUID upload URLs and immediate AvatarContext updates. Valid historical keys
  need not be treated as immutable unless their actual storage policy guarantees it.

### Writes and ownership

- Upload remains object-first, mapping-second. Validate image content, write a unique
  object, then commit the path. Do not acknowledge success if the D1 write fails.
- Remove the admin free-text avatar-key editor and generic CRUD mutation of that
  field. Route replacement through the validated upload flow; any clear action
  clears the mapping with the existing authorization and invalidation rules.
- All creation, deletion, purge, and import paths preserve the path-only invariant.
  Audit deletion code for shared references before allowing any object deletion;
  the normalization campaign itself never deletes objects.
- Posting permission is `avatar_path != ''`; admin presence filtering uses the same
  predicate. Remove `hasAvatar` from entity DTOs. The user-facing filter may retain
  its descriptive query name, but it is derived, never persisted or dual-read.
- Future imports must receive verified object mappings for new users, or explicitly
  create avatar-less users. They must preserve app-owned paths on conflict and must
  not turn a historical status flag into a new path. Retire obsolete duplicate
  importer entrypoints if they cannot satisfy this contract; do not leave runnable
  paths that recreate the old schema.

### Schema and cached data

- Add a new forward migration dropping `users.has_avatar` and `users.avatar` after
  manifest verification. Preserve historical migration files; fresh databases apply
  the complete chain and end with only `avatar_path`.
- Inspect dependent indexes, triggers, views, and SQL before choosing supported
  SQLite DROP COLUMN operations. Rehearse with representative user-table volume;
  measure temporary storage and D1 statement constraints. Do not assume a multi-GB
  table rewrite fits the production database's 10 GB limit or execution bounds.
- Update maintained schemas, importer schemas, SQL allowlists, tombstones, shared
  types, native consumers, and tests. Regenerate `init-sql.generated.ts` and other
  generated artifacts using their existing commands.
- Invalidate only avatar-bearing KV/display families with a one-time payload/key
  version cutover, restart Web/Admin processes, and reject old signed read snapshots.
  Do not fall back to old cache versions or delete the whole namespace (sessions and
  unrelated data must survive). Document the exact affected families during build.

## Coordinated rollout and recovery

1. Finish implementation, local rehearsal, full validation, and production artifact
   builds before the maintenance window. Prepare a deployment allowlist; ordinary
   deployment must not run the destructive migration before the manifest is verified.
2. Review the inventory, unresolved count (must be zero), permission changes, expected
   D1 writes, rewrite headroom, rollback procedure, and approved maintenance duration.
3. Enable and verify the full fence at the actual public/admin/direct Worker entry
   points. The exact temporary operational controls and their removal are part of
   the execution runbook and require approval. A settings toggle alone is not proof.
4. Drain requests/background writes; record a D1 Time Travel bookmark and matching
   deployed revisions while writes are stopped. Verify restore access and rehearse
   recovery locally. Preserve the manifest and old-value journal outside the database.
5. Refresh the manifest, apply path updates, and verify completeness. Only then use
   migration-first `bun run worker:deploy` for the tested path-only Worker, followed
   by the matching Web/Admin artifacts. This repository still uses Wrangler config;
   do not run `cf deploy` or migrate its toolchain as part of this task.
6. Activate the new cache/snapshot versions, remove the obsolete avatar proxy rule,
   and smoke-test while the fence remains closed. Include missing avatars, preserved
   historical avatars, current GUID avatars, permissions, anonymous content, and upload.
7. Reopen writes only after acceptance. Record revision/schema identities, counts,
   commands, cache changes, and results. No opportunistic R2 cleanup follows cutover.

Before reopening, a failed cutover restores the matching D1 bookmark and old
application revisions together under the fence; a code-only rollback after dropping
columns is invalid. After reopening, never restore the whole database automatically:
that could erase new posts or uploads. Prefer a forward fix, or obtain explicit
approval for a reconciled recovery that preserves intervening writes. Recovery is
an operational emergency procedure, not a shipped compatibility path.

## Atomic implementation commits

1. `feat: add avatar normalization manifest` - offline inventory/join/apply tooling,
   local fixtures and tests; no default remote writes or runtime changes.
2. `fix: normalize avatar identity end to end` - one coherent schema/API/Web/Admin/
   importer/native cutover, cache versions, route removals, tests and updated docs.
   Do not split this into commits whose runtime requires an undeployed schema or
   whose schema drops fields still used by the corresponding code.
3. `docs: record avatar cutover verification` - non-sensitive approved execution
   receipts and measured observations after the separately authorized migration.

Each commit uses normal hooks and is completed before the next unit is edited.
No release, push, migration, or deployment is implied by committing the plan.

## Verification and acceptance

### L1: unit and static checks

Test inventory pagination/completeness, UID parsing, ambiguous candidates, invalid
keys/images, tombstones, stale flags in both directions, missing current GUIDs,
batch interruption/resume, expected-value conflicts, and unchanged-row suppression.
Test path-only rendering across Web/Admin, DTO completeness, posting filters,
upload failure ordering, cache rejection, and native deserialization.

Run `bun run typecheck`, `bun run lint`, `bun run build`, and
`bun run test:coverage`; require the declared all-four 95% L1 target without skipped
or focused tests or weakened thresholds. Report existing package branch-floor gaps
separately; passing today's hooks is not proof of full L1 attainment. Run Rust
fmt/clippy/tests when native code changes. No new quality-gate implementation is
part of this avatar task.

### L2: local real services and migration rehearsal

Use disposable local D1/R2/KV fixtures and a local URL, never remote test resources.
Apply the complete schema chain and the one-time mapping to representative mixed
users. Verify object-first uploads, admin authorization, posting permission, deleted
users, schema removal, and safe replay. Run `bun run gate:l2` and update route
coverage for removed endpoints. Rehearse the freeze/cutover/recovery sequence and
measure the large-table migration independently of unit fixtures.

### L3: browser behavior

Run `bun run test:e2e:bdd` sequentially for forum/admin. Intercept requests and prove
that a no-avatar user requests neither `/api/avatar/*` nor a guessed CDN key.
Cover thread lists, posts, comments, messages, profiles, header/session avatars,
admin lists/details, anonymous/deleted users, and upload without stale default images.
Verify the default asset is local and there is no fallback loop or extra user query.

### G2, D1 isolation, and production acceptance

Use existing secret/dependency gates and normal commit/push hooks; do not commit
inventory records or credentials. Test state must be marked, isolated and safely
cleaned without touching developer or production resources. Do not repair unrelated
gate shortcomings in this change.

Production acceptance requires zero unresolved mappings; every persisted nonempty
path matches verified object evidence; no production `has_avatar`/`avatar` columns;
no active UID-guessing branch; correct avatar-based permission results; and no
new per-avatar D1/KV work. Historical migrations and the one-time inventory parser
are the only legitimate remaining references to historical fields/key layouts.

Compare complete 24-hour and 7-day post-cutover windows to the recorded baseline:
R2 missing-key operations, CDN avatar 404s by UA, default-image traffic, D1/KV usage,
and upload errors. Do not promise zero global 404s: external clients and old browser
tabs can continue requesting retired URLs. Fresh application pages must generate
zero speculative avatar requests. Cost claims require billing evidence, not only
sampled request counts.

## Documentation to update during implementation

Replace the obsolete fallback/flag contract in `docs/15-avatar-upload.md`,
`docs/02-database-schema.md`, `docs/28-edge-cache-optimization.md`,
`docs/36-daily-statistics-and-read-snapshots.md`, and `docs/api-architecture.md`.
Update import/API documentation and exact route coverage alongside the code.
Record actual incidents in `Retrospective.md`, not speculative accident narratives.
