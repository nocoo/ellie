# Daily statistics and read snapshots

Status: implementation in progress. Authorized patch release: v1.14.9.

## Accepted behavior

The forum is in low-traffic maintenance operation. Statistics may lag until the next daily rebuild. Approximate totals may make the final page temporarily unreachable. Page membership and ranking may lag briefly, but current authorization, hidden content, bans and anonymous identity projection remain mandatory.

## Statistics

A daily Worker job at 03:00 Asia/Shanghai builds one bounded statistics snapshot: site totals, day totals, per-forum counts and per-category counts. It writes a persistent KV base and a version-tagged optimistic delta. Successful business writes update approximate deltas without recounting. Concurrent/lost deltas and snapshot-boundary discrepancies are accepted until the next successful rebuild. Separate base ownership prevents old mutation requests overwriting a newly rebuilt base.

Web stores the merged snapshot in process memory. Cold starts hydrate from the authenticated KV-only Worker endpoint. Warm rendering performs no statistics I/O. Hourly background refresh discovers newer daily snapshots and cross-process mutations; errors preserve the last good snapshot. No request-time D1 fallback, midnight eviction or exact recount. Missing data is an unavailable/zero estimate, never a reason to scan business tables. Current-day projection resets yesterday's today counters without requiring a rebuild.

## Other read reductions

Forum configuration is stored in KV and memory with a one-day bound. Recommendation IDs have a thirty-minute bound. Membership and ordering for the first three list pages have a five-minute bound; deep pages are not persistently cached. Worker independently checks bounded snapshots and current forum ancestry, topic visibility and author projection before serving a display. Membership mismatch is filtered/reloaded with bounded work, never served as stale private content.

Web forwards bounded read snapshots on warm context requests so the Worker need not read KV for every view. KV restores reusable selections after Web restart. Snapshots never contain current users, sessions or privileged identity projections. Display invalidation remains independent from daily statistics. Administrative configuration and recommendation writes invalidate their KV selections and notify Web to clear read snapshots. Lost notifications can leave display fields stale until their 24-hour/30-minute bounds; current posting policies and access rules remain independently authoritative. Daily memory has a separate 2 MiB bound; read/display snapshots share the existing 8 MiB runtime payload ceiling.

## Validation and rollout

- Tests cover daily rollover, KV failure/corruption, version mismatches, optimistic updates, restart hydration and no SQL-count fallback.
- Read tests cover hidden/moved/deleted topics, changed ancestors, stale configuration, category changes, snapshot bounds and deep-page behavior.
- Run normal project checks and hooks, local real-HTTP L2 and relevant browser lanes. Preserve current coverage floors and report existing 95% branch-standard gaps.
- Deploy migration-first Worker and verify existing readers remain usable during cutover; bootstrap the daily snapshot once using the authenticated refresh operation; then deploy matching Web/Admin revision.
- Capture immutable production baseline before deployment. Compare complete post-cutover windows using D1 query counts and rows read, KV operations, execution errors and deployed identities. Adaptive estimates are not billing receipts.

## Evidence

Pending implementation, test and release receipts.
