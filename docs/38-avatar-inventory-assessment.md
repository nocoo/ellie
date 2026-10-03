# 38. Avatar Inventory Assessment

Date: 2026-10-03. Historical read-only preflight for
[avatar normalization](37-avatar-path-normalization.md).

## Scope and evidence

Exported the complete `tongjinet` R2 object metadata inventory and the narrow
`tongjinet-db.users` avatar projection. No image bodies were downloaded; this is
an inventory, not an object-content backup. No production writes, object deletion,
schema changes, deployments, or cache-rule changes occurred.

| Source | Export result |
| --- | --- |
| R2 | 622,696 unique keys, 623 pages, 22,704,584,394 payload bytes |
| D1 users | 1,142,949 unique users, 115 primary-key pages, 1,142,949 rows read |
| R2 inventory interval | Approximately 01:48:59-02:09:46 UTC, including local finalization |
| D1 inventory interval | First page captured before the 01:49:26 UTC runner; remaining pages completed at 01:51:18 UTC |
| Additional D1 reads | Five posting settings and 1,728 potentially affected nonnegative-status user profiles; no contact or credential fields |

The R2 inventory includes attachment, avatar, avatars, ellie, post-images, and
static prefixes. All R2 pages and D1 pages have SHA-256 receipts. Local SQLite
primary keys reject duplicate objects/users. Per-page success and D1 zero-write
metadata were checked. The final R2 page contains 696 objects and omits pagination
metadata; preceding pages include `is_truncated=true` and unique continuation
cursors. The total independently matches the previous storage analytics count.

The installed `cf` output formatter drops R2 `result_info`. A run-local Node fetch
preload captured only successful responses from the exact bucket-list API path,
retaining the envelope without logging request headers or credentials. All requests
still ran through `cf`; no installed CLI file or authentication configuration changed.
The first page and the final page were each fetched twice during response-shape
discovery: 625 logical R2 list requests for 623 retained pages. There were no
per-user R2 HEAD/GET requests or repeated full-bucket scans.

This is a live, non-atomic preflight snapshot. It must not be applied as though
uploads and deletions were frozen during export. Later analysis reuses the local
inventory; production cutover still needs a proven reconciliation/fence boundary.

## Population assessment

| Classification | Users | Proposed action |
| --- | ---: | --- |
| Existing explicit path, matching nonempty image object | 43 | Preserve path |
| Empty explicit path, unambiguous existing legacy big image | 151,360 | Backfill exact key |
| Empty path, no matching avatar object | 991,538 | Keep empty; render local default |
| Tombstoned/purged | 2 | Keep empty; do not rediscover old objects |
| Missing big image, but smaller variants exist | 6 | Hold for explicit migration policy decision |
| **Total** | **1,142,949** | Every user classified once |

The baseline has 92,555 `has_avatar=1` users and only 43 nonempty `avatar_path`
values. Object evidence therefore differs materially from the old flag:

- 90,957 flagged users have a recoverable legacy big image.
- 60,403 unflagged users also have a recoverable legacy big image.
- 1,549 flagged users have no matching usable avatar object.
- Six additional flagged users retain only smaller variants.
- All 43 explicit current paths exist; zero broken current paths were found.

The ready subset contains 151,403 avatar-bearing users and needs 151,360 path
updates. There are no shared current/resolved paths, no detected current-key owner
conflicts, and no ambiguous multi-layout mappings in that subset. Selected objects
have nonzero size and JPEG/PNG HTTP metadata. Image bytes have not been decoded or
independently verified; metadata evidence must not be described as image-content
validation.

## Owner decision after assessment

The owner subsequently authorized implementation, database migration, and Z+1
release. All six smaller-only cases must be treated as no avatar, not mapped to a
smaller image. Final planned backfills remain 151,360; preserved paths remain 43;
empty non-tombstoned users become 991,544. Avatar-gate losses become 1,555 total,
including 69 nonnegative-status users after staff/registration checks. The initial
recommendation and counts below document the assessment, not the accepted policy.

## Six smaller-only cases

Four users have a middle image; two have only a small image. Three users have
nonnegative status; three are already restricted. All six have `has_avatar=1`.
Their IDs and exact keys are retained only in the ignored local assessment.

Recommended explicit plan amendment: during this one-time mapping only, choose
the largest existing verified variant, preferring middle to small. Persist the
chosen actual key, with no runtime size guessing or fallback chain. If approved,
the campaign would backfill 151,366 paths and preserve avatars for 151,409 users.
Inspect these six selected image bodies before approving the final manifest.

Until that choice is accepted, they remain unresolved and the campaign must not
clear their avatar state or apply a partial final manifest as a complete migration.

Other retained objects:

- 52 legacy big images have no matching user. Leave them untouched.
- Seven GUID-prefix objects are not referenced by current user paths. Leave them
  untouched; unreferenced does not authorize garbage collection.
- `avatar/index.htm` is the only unparsed object under the legacy avatar prefix;
  it is not an avatar candidate. No numeric-import or hash-layout avatar objects
  were found. The obsolete `users.avatar` values do not exactly match any existing
  object keys for users with empty current paths.

## Posting-permission consequences

Current settings enable posting restrictions, require an avatar, and require one
registration day. Thread/reply global switches are enabled.

| Effect | All users | Nonnegative-status users | Actual avatar-gate effect after staff/age checks |
| --- | ---: | ---: | ---: |
| Old flag denies presence, actual image exists | 60,403 | 1,659 | 1,653 gain the avatar condition; six staff bypass it already |
| Old flag grants presence, no image exists | 1,549 | 66 | 66 lose the avatar condition |
| Smaller-only, pending decision | 6 | 3 | Preserve the condition if the proposed variant mapping is accepted |

These are effects within `checkPostingPermission`, not a claim that every affected
account can or cannot complete a post. Email verification, authentication, forum
permissions, and other independent gates still apply. Most population-level
changes concern already restricted historical accounts; do not confuse them with
newly blocked active users.

## Local artifacts and reproducibility

Private, Git-ignored directory: `reference/avatar-normalization/20261003/`.
Directory permissions are 0700; artifact files are 0600. Approximately 572 MB
including raw pages, SQLite, manifest CSV and checksums. No customer records or
inventories are committed to Git.

| Artifact | Purpose |
| --- | --- |
| `r2-envelope-*.json`, `r2-complete.json` | Complete raw R2 metadata pages and checksum receipts |
| `users-*.json`, `users-complete.json` | Narrow user projection and checksum receipts |
| `inventory.sqlite` | Objects, users, and classified mappings; repeat analysis without remote queries |
| `mapping-manifest.csv` | Per-user expected old path, proposed path, classification, size, ETag, MIME |
| `assessment.json` | Aggregate assessment, posting impact and six unresolved cases |
| `posting-impact-private.json` | IDs and limited profile evidence for avatar-gate changes |
| `checksums.json` | Artifact hashes |
| `export.py`, `capture-response.mjs` | Read-only resumable export used for this run |
| `analyze.py`, `test_analyze.py` | Offline join/classification and eight fixture checks |

Recorded hashes:

- `inventory.sqlite`: `fa71421af66dc2aff4b668349d71c81cb011333eee3a26dc4b511cf9439108e2`
- `assessment.json`: `0e89bade90cc606eeb96f900adb0a6b6c6a0a36ce43ef5671d12cfb1cc8588f0`
- `mapping-manifest.csv`: `55bbb97df21ffd99afc57a8505e62bdfc75a1e2dc737c9af76b29a17b2096238`

The local scripts are run artifacts, not shipped application code or an authorized
write tool. Eight standard-library unit checks passed for known layouts, unsafe
keys, false flag assumptions, current-path precedence, missing-current behavior,
tombstones, ambiguity, and metadata limitations. These checks do not certify full
project L1 attainment or validate production image contents.

## Next execution gates

1. Approve the six-case largest-existing-variant rule and acknowledge the 66-user
   avatar-gate loss. Review private IDs locally, not in tracked documents.
2. Implement the coherent path-only runtime/schema/importer cutover from plan 37,
   using this inventory for offline fixtures and analysis, not another R2 scan.
3. Rehearse the migration and recovery, then approve and verify the write-fenced
   maintenance window and final reconciliation before any production write.

## Production execution

Completed on 2026-10-03 as explicitly requested Z+1 release 1.14.20.

- Implementation: `53b5e803`; browser fixture correction: `a5e4a790`; release:
  `74ab19dea34649408c62522885201aeb8a7ffaf7`.
- The owner chose no avatar for all six smaller-only users. No runtime fallback
  was added. Avatar-gate losses are 1,555 overall, including 69 nonnegative-status
  accounts; gains remain 60,403 overall, with 1,653 non-exempt avatar-gate gains.
- A temporary prior-code request fence was deployed at approximately 02:43 UTC.
  It denied public/admin/auth/upload/internal writes, allowed only health and the
  authenticated statistics read, and disabled scheduled work. The matching new
  Worker honored the same freeze through a temporary operational binding.
- A D1 recovery bookmark was captured after drain. The 43 existing explicit paths,
  total population, tombstones and all 151,360 expected-old backfill rows matched
  the inventory. No path/status conflicts occurred. No R2 re-list or object probe
  was used for the migration; account audit inspection returned no R2 events and
  the bucket has no object-deletion lifecycle policy. Those checks are supporting
  evidence, not an atomic cross-service storage snapshot guarantee.
- Applied 151,360 updates in 76 batches; each SQL batch used a primary-key join
  and expected-old-value/status/deletion guards. D1 reported 151,360 written rows,
  756,800 read rows, and a maximum update-query duration of 47.3129 ms. Every path
  was read back and matched the manifest before schema changes.
- Final population: 1,142,949 users; 151,403 explicit avatar paths; 991,546 empty
  paths including two tombstones. Zero tombstone avatars were restored.
- Cloudflare twice rejected the migration runner's multi-statement DDL request
  with internal error 7500, leaving 0057 unapplied and both columns present.
  The exact statements were then executed individually with `cf`: dropping
  `has_avatar` took 1,942.7231 ms; dropping `avatar` took 1,947.1612 ms; creating
  `idx_users_avatar_path` took 348.3073 ms. The column/index/count postconditions
  were verified before inserting the migration bookkeeping record. A subsequent
  normal `bun run worker:deploy` completed migration-first and deployed the Worker.
- Removed only the obsolete `/api/avatar/` branch from the existing forum cache
  rule; verified the sibling rule unchanged. No R2 objects were copied, modified
  or deleted, and no session namespace was cleared.
- Matching CI and Docker deployment succeeded for the exact release SHA:
  [CI 37090911416](https://github.com/nocoo/ellie/actions/runs/37090911416),
  [Release 37091251685](https://github.com/nocoo/ellie/actions/runs/37091251685).
- Worker, forum and admin `/api/live` all reported 1.14.20 before unfreezing.
  The final Worker version is `974abfaa-289f-4a98-af79-f8b833a2af16`, deployment
  `96dfec93-bfba-4d44-9c88-56f515ecb22a`. The temporary freeze binding was removed.
- Normal hooks, strict lint/typecheck, production builds, coverage gates, 382 local
  real-HTTP tests and the 183-route strict coverage audit passed. Forum browser
  acceptance had 81 passes, one additional scenario passing after retry and four
  pre-existing skips; Admin had 50 passes. Existing package branch coverage gaps
  against the all-four 95% contract remain explicit.
- Production read-only checks covered normalized/missing-avatar users, forum/admin
  DTOs, removed endpoint 404, rendered page responses, and both local GIF defaults.
  Anonymous browser smoke reached the required-login page without errors; it does
  not certify an authenticated production journey. No production test upload or
  user mutation was performed during smoke checks.

Private execution artifacts are under
`reference/avatar-normalization/20261003/cutover/`, including the approved manifest,
expected-state reads, all mutation/readback receipts, DDL receipts, recovery bookmark,
deployment IDs and final checks. Long-window post-release R2 savings require future
complete 24-hour/7-day observations; they are not claimed by this release.
