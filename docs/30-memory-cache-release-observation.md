# v1.14.2 memory-cache release observation

## Scope and baseline identity

On 2026-09-24 the owner authorized a patch release, production deployment and
observation, explicitly requiring the baseline before rollout. The previous
implementation-only restriction is superseded for this release. Target v1.14.2
follows the explicitly requested Z+1 increment.

Baseline was captured before new secrets, migrations or application changes.
Web/Admin live revision was `cd88860bdddb39ea87fa77f544bb65c217452c55`, deployed
by successful Release run 35829067164. All three `/api/live` endpoints returned
1.14.1; the Worker deployment version was
`e528b91a-567d-40fc-be86-b68a4ed0edc9`.

Cloudflare GraphQL adaptive analytics window: **2026-09-22 22:00:00Z through
2026-09-23 22:00:00Z**, end exclusive (Shanghai September 23 06:00 through
September 24 06:00). These are observed adaptive estimates, not invoice totals.

| Metric | Pre-release 24 hours |
| --- | ---: |
| KV reads | 831,281 |
| KV writes | 64,943 |
| KV deletes / lists | 373 / 290 |
| Worker requests / execution errors | 128,542 / 0 |
| KV reads per Worker request | 6.47 |
| KV writes per Worker request | 0.505 |
| D1 read / write queries | 51,886 / 1,964 |
| D1 rows read / written | 4,533,182 / 3,343 |
| Old visit-analysis DO requests | 5,170 |
| DO success / clientDisconnected requests | 5,089 / 81 |

KV read results: 507,060 hot (61.0%), 141,388 cold (17.0%), and 182,833 not-found
(22.0%). Missing cache generations are not necessarily user-visible errors.
The DO errors aggregation is explained by client disconnects; it must not be
reported as 81 application crashes.

Production Docker samples before configuration: Web 480 MiB / 0.56% CPU,
Admin 230.1 MiB / 0.05% CPU. These are instantaneous container readings,
not cache payload estimates or comparable performance benchmarks.

## Hourly context

All rows below are September 23 UTC, one-hour buckets. Traffic and request mix
vary substantially; the quiet 19:00/20:00 buckets cannot stand in for a normal day.

| UTC hour | KV reads | KV writes | Worker requests | Reads / request |
| --- | ---: | ---: | ---: | ---: |
| 14:00 | 49,013 | 3,711 | 6,114 | 8.02 |
| 15:00 | 30,576 | 2,202 | 4,926 | 6.21 |
| 16:00 | 11,774 | 1,556 | 2,469 | 4.77 |
| 17:00 | 9,714 | 1,345 | 1,817 | 5.35 |
| 18:00 | 9,861 | 891 | 1,566 | 6.30 |
| 19:00 | 1,049 | 242 | 1,044 | 1.00 |
| 20:00 | 193 | 35 | 1,458 | 0.13 |
| 21:00 | 14,794 | 1,383 | 3,214 | 4.60 |

## Reproducible measurement scope

Use account `d51a8fde361e4be31db17d8c56737c1f`, script `ellie`, production KV
namespace `9506856500c34ceb82ab989063962a6d`, and D1 database
`2b4bbcda-6a08-45bf-bbde-badfa4d73c8f`. Query the same start-inclusive,
end-exclusive time filters and dimensions for comparisons:

- `kvOperationsAdaptiveGroups`: count by hour, actionType, result and responseStatusCode.
- `workersInvocationsAdaptive`: sum requests/errors/subrequests; hour and status.
- `d1AnalyticsAdaptiveGroups`: sum readQueries/writeQueries/rowsRead/rowsWritten.
- `durableObjectsInvocationsAdaptiveGroups`: sum requests/errors by script and status.

Read schema introspection before relying on metric fields. Preserve aggregation
windows and distinguish metric lag or empty results from confirmed zero usage.
Do not use direct production SQL scans to estimate platform costs. Raw local
baseline receipt: `/tmp/ellie-pre-release-baseline.json`.

## Rollout and observation

1. Preserve the existing environment files; configure distinct statistics and
   management secrets and Admin's `http://web:7031` target without logging values.
2. Merge the already-published dependency updates and validate the installed
   Next.js 16.3.6 runtime, especially prefetch exclusion.
3. Release through normal commit/push hooks and exact-revision CI; deploy Worker
   through `bun run worker:deploy` so migration 0055 precedes dependent code.
4. Let the existing Release workflow deploy Web/Admin. Verify version and source
   revision, not merely a successful HTTP response. No overlapping view writers.
5. Observe actual Web memory hit/miss, bounded payload, pending buffers, successful
   timed flush and process identity. Use bounded read-only production probes;
   do not create synthetic users or mutate live business content.
6. Compare complete short pre/post windows after metric lag, normalized by
   Worker requests, and report their request-mix limitation. A short observation
   is preliminary; full-day cost savings require comparable later traffic.

The GitHub Release receipt and final report record rollout times, exact CI/deploy
runs and post-release measurements. The baseline above remains immutable.
