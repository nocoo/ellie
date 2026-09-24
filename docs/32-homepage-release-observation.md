# v1.14.3 homepage release observation

## Scope and production identity

The owner authorized a patch increment, production rollout and before/after
observation on 2026-09-24. This supersedes the implementation-only restriction
in document 31 for this release. Inspect observed peaks and resource headroom;
do not load-test production or create synthetic business records.

Before rollout, Web, Admin and Worker reported `1.14.2`. Web/Admin images were
built from `c3a15d5df7cfe6c1b247add8076b251005032acf` by successful CI 35928075395
and Release 35928745851. Web memory started at `2026-09-23T22:34:36.387Z`.
Worker deployment `c2c32e45-76d2-49d0-be77-ed18c8617c84` serves version ID
`6b13b03a-13bb-43d3-9588-a41d14683563`. All three health endpoints passed.

The reviewed implementation ends at `d4f723cd`. The independent final review
closed both P2 findings: shared bounded load accounting and isolated optional
statistics failure. No new D1 migration or secret is required; remote migration
inspection confirmed no pending migrations before release.

## Immutable pre-release measurements

Cloudflare adaptive estimates, start-inclusive/end-exclusive UTC windows:

| Metric | 2026-09-23 23:00 to 2026-09-24 01:00 | 2026-09-24 00:45 to 01:00 |
| --- | ---: | ---: |
| Worker requests | 7,676 | 666 |
| Worker execution errors | 0 | 0 |
| KV reads | 64,282 | 3,679 |
| KV writes | 2,616 | 69 |
| KV reads / Worker request | 8.374 | 5.524 |
| KV writes / Worker request | 0.341 | 0.104 |
| D1 read queries | 4,773 | 248 |
| D1 write queries | 140 | 11 |
| D1 rows read | 372,671 | 23,369 |
| D1 rows written | 256 | 22 |

The two-hour forum-zone sample contains 17,336 HTTP requests, zero HTTP 5xx and
5,410 edge hits (31.21% of all requests, including dynamic and non-cacheable
requests). KV returned no quota/throttle/server failures in the sampled groups;
`not_found` includes expected absent cache generations, not only failed business
lookups. The retired visit-analysis Durable Object returned no invocation groups;
this absence is consistent with its deletion, not a universal analytics-lag proof.

Compared with document 30's pre-v1.14.2 full-day baseline, the two-hour average
has lower KV writes/hour (1,308 versus 2,706) but higher reads/request (8.37 versus
6.47). Different traffic and request mixes prevent causal savings claims. The
initial post-v1.14.2 15-minute sample had only 2.61 reads/request; later traffic
demonstrates why that short quiet interval cannot predict full-day cost.

## Existing memory behavior and headroom

Read-only management snapshot at `2026-09-24T01:09:42.106Z`:

- Estimated payload: 76,419 bytes / 8,388,608 bytes (0.91%). Last sixty minute
  samples peaked at 148,474 bytes (1.77%) and eighteen pending views.
- Since process start: site-stats 142 hits / 44 misses; forum-summary 3,979 /
  2,369; thread-count 66 / 30. All three families report zero load errors.
- Latest successful statistics flush: `2026-09-24T01:09:36.633Z`; zero unconfirmed
  views, dropped views or dropped activities. Pending data remained bounded.
- Management process RSS was 332,279,808 bytes. Separate Docker samples reported
  Web 272.9 MiB / 2.12% CPU and Admin 120.1 MiB / 0.05% CPU. These are different
  instantaneous measurements, not the cache payload or a heap-leak diagnosis.

The earlier in-memory statistics implementation is active and comfortably below
its payload limit. Remaining per-read KV fan-out, rather than cache payload size,
is the next cost target. The new homepage family is limited to four audience
snapshots, 512 KiB each, within the existing total budget; request loads share the
existing sixty-four-load process limit.

Cloudflare's published paid KV allowance is ten million reads/month, then
$0.50/million; one million writes/month, then $5/million. Paid reads have no daily
hard quota; same-key writes remain limited to one/second. Account billing access
was unavailable to the current token, so published plan limits are reference
values, not an assertion of the account's remaining included quota or invoice.

## Rollout and comparison procedure

1. Synchronize first-party versions to `1.14.3`, preserve dependency resolution,
   update the changelog and pass normal commit/push hooks.
2. Deploy Worker through migration-first `bun run worker:deploy` before Web/Admin
   can switch to the new context endpoint. Keep the existing secrets and routes.
3. Push the reviewed release commit and tag, verify its exact CI and subsequent
   Docker Release run, and publish the matching GitHub Release.
4. Verify all live versions, Worker deployment ID and Docker image revision.
   Observe natural traffic warming `home-display`, current permission checks,
   memory bounds and another successful timed statistics flush.
5. Compare a complete fifteen-minute post-cutover window after analytics lag
   against the preserved fifteen-minute baseline. Report totals and per-request
   rates together, with HTTP errors, D1 work and cache headroom.

The GitHub Release receipt records final rollout times, exact commit/tag/run IDs
and post-release measurements without rewriting this pre-release baseline.
Local raw receipts use `/tmp/ellie-1.14.3-before-*` for this rollout and the
previous release's immutable files referenced by document 30.
