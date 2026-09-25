# Daily statistics and read snapshots

Implementation: v1.14.9. Operational receipts and timestamped observations accompany the matching GitHub Release.

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
- Bootstrap the daily snapshot once with the same aggregation function using authenticated Cloudflare D1/KV APIs, then deploy migration-first Worker and verify existing readers remain usable during cutover. Deploy the matching Web/Admin revision only after Worker verification. Routine rebuilds use the authenticated refresh endpoint or the daily cron.
- Capture immutable production baseline before deployment. Compare complete post-cutover windows using D1 query counts and rows read, KV operations, execution errors and deployed identities. Adaptive estimates are not billing receipts.

## Evidence

### Local validation

Implementation commit: `94821dbbdf92f29d84474a4135214f417a0ae5d6`.

- Normal pre-commit gates passed with `VITEST_MAX_WORKERS=4`: strict staged lint, TypeScript build/typecheck, staged secret scan, all 8,687 coverage tests, and 385 local real-HTTP tests. Unbounded worker concurrency caused transient timeout failures in earlier attempts; no timeout, assertion, test or threshold was relaxed.
- Production builds for Web and Admin completed successfully at version 1.14.9.
- Forum browser lane: 78 passed, four existing skips (external challenge and fixture-data gates). Admin browser lane: 38 passed. Both use local isolated Worker resources and run sequentially.
- Static L2 audit: 184 routes covered, zero uncovered routes, zero unmatched calls. Three negative boundary probes are excluded from endpoint coverage.
- Worker coverage: statements 95.09%, branches 90.37%, functions 98.16%, lines 96.69%.
- Web coverage: statements 96.53%, branches 94.67%, functions 95.49%, lines 97.73%.
- Admin coverage: statements 96.27%, branches 93.36%, functions 96.39%, lines 97.96%.
- Existing project gates pass; the required all-four 95% standard is not attained by the current Worker/Web/Admin branch metrics. The migrate package also retains a pre-existing branch gap (90.79%).
- Focused anonymous hot-read tests prove two D1 queries and zero KV operations with a valid signed selection; restart restoration performs three KV reads before the same two current-authority queries. Authenticated readers additionally verify their current user.

### Production verification

The matching GitHub Release records the Worker deployment identity, exact-revision CI, Web/Admin deployment and timestamped production observations. Compare complete post-cutover windows with a fresh pre-deployment baseline; preserve cold-start and bootstrap windows separately. Local operation budgets are not measured production savings.
