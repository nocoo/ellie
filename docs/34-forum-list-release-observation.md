# v1.14.4 forum-list release observation

## Scope and baseline identity

The owner authorized a patch increment, production rollout and before/after
observation for v1.14.4 on 2026-09-24. Target v1.14.4 follows the requested
Z+1 increment over v1.14.3. Inspect observed peaks and resource headroom; do
not load-test production or create synthetic business records. The previous
implementation-only restriction is superseded for this release.

Baseline was captured before new secrets, migrations or application changes.
All three `/api/live` endpoints reported `1.14.3` at
`2026-09-24T03:26:44.668Z`. Web and Admin started `2026-09-24T01:30:00.318Z`
and `01:30:00.322Z` respectively with uptime 7,004 s (≈1h57m), image
`sha256:f046a7bb131caaef55d222bb48683802c41a0a8e48b32cc66995c54005ff061d` for
Web and `sha256:3b16f09b77fd7d5bd9978b9e4d2e6fa5a5f15d95e3e5f63536ad8758809e644c`
for Admin. Both containers carry the exact release revision
`411cb4b1f9b05d7b46bb38a45c84ade217adb2db`. The Worker has not been redeployed
since v1.14.3; the latest deployment remains
`a10551f2-7294-40eb-8799-4cc4054c1fe1`, version
`40b7830a-ec9c-45ec-b396-c71e57233adb`, created
`2026-09-24T01:16:14.420025Z`. No new D1 migration or secret is introduced.

All three health endpoints passed. Local Docker logs for ellie-web only
contained seventeen lines (Next.js boot markers plus four
`[auth][error] CredentialsSignin` lines from the existing login flow); the
management contract exposes load errors as a cumulative count only and does not
classify their cause, so the Docker log sample provides no per-error attribution.

## Immutable pre-release measurements

Cloudflare adaptive estimates, start-inclusive/end-exclusive UTC windows:

| Metric | 2026-09-24 03:00 to 03:15 (15 min) | 2026-09-24 01:45 to 03:15 (1h30m, post-cutover) |
| --- | ---: | ---: |
| Worker requests | 787 | 6,207 |
| Worker execution errors | 0 | 0 |
| KV reads | 6,678 | 53,402 |
| KV writes | 226 | 1,876 |
| KV deletes | 11 | 42 |
| KV reads / Worker request | 8.486 | 8.603 |
| KV writes / Worker request | 0.287 | 0.302 |
| D1 read queries | 441 | 3,499 |
| D1 write queries | 23 | 144 |
| D1 rows read | 28,144 | 184,834 |
| D1 rows written | 48 | 286 |
| D1 read queries / Worker request | 0.561 | 0.564 |
| D1 write queries / Worker request | 0.029 | 0.023 |

Per-hour derived rates for the 1h30m clean window:

- Worker requests / hour: 4,138
- KV reads / hour: 35,601
- KV writes / hour: 1,251

The two-hour sample 2026-09-24 01:00 to 03:00 UTC is also retained but straddles
the 01:30 Web/Admin cutover: it mixes 30 minutes of v1.14.2 Web memory state
with 90 minutes of v1.14.3 state. The clean 1h30m window above is the
authoritative pre-v1.14.4 baseline.

The KV read result split for the clean window: 35,399 hot (66.3%), 12,302 cold
(23.0%), 3,492 200/not_found (6.5%), and 2,209 404/not_found (4.1%). KV returned
no quota, throttle or server failures. The `not_found` rows include expected
absent cache generations, not only failed business lookups.

## HTTP observations

Cloudflare zone `e9afae61260e0208d10089c287554009` adaptive HTTP requests for
`clientRequestHTTPHost:"bbs.tongji.net"`. Edge hit ratio counts only
`cacheStatus:"hit"` rows (200 or 304). Other cache states are reported separately;
in particular, misses and expired entries can require an origin fetch.

| Window | Total requests | HTTP 5xx (≥500) | Edge hits (`hit` only) | Edge hit ratio |
| --- | ---: | ---: | ---: | ---: |
| 2026-09-24 03:00 to 03:15 (15 min) | 1,484 | 3 | 243 | 16.37% |
| 2026-09-24 01:45 to 03:15 (1h30m clean) | 12,651 | 3 | 3,379 | 26.71% |

The 1h30m clean window recorded three HTTP responses with
`edgeResponseStatus:524`. Status 524 is Cloudflare's origin-timeout response,
not a Worker application 5xx. All three are `cacheStatus:"dynamic"` and all
three sit in the 03:00 UTC hour on non-homepage forum paths; the
homepage-specific probe below (path `"/"`) shows only 307/200/301/499 status
codes and no 524s, so the three origin timeouts are not from the homepage.
The Worker dataset reports zero execution errors; it does not establish a count
of application-returned HTTP 5xx. HTTP health is not clean: three forum-zone requests
exceeded the origin's response budget and were answered 524 by the edge. The
clean window also reports 44 HTTP 403 responses with unclassified causes, 39
client-closed 499s, and 32 explicit cache misses that triggered an origin
fetch.

The home-only HTTP probe (`clientRequestPath:"/"`) for the same 1h30m clean
window reported 273 dynamic/307 redirects, 203 dynamic/200 responses, 4 none/301
redirects, and 3 none/499 client closures — 483 homepage requests, all dynamic
or none, zero edge cache hits on `/`. This matches the post-v1.14.2
homepage-always-dynamic behavior and shows the three HTTP 524s are not from
the homepage path.

Cloudflare's published paid KV allowance remains ten million reads/month then
$0.50/million and one million writes/month then $5/million; same-key writes
remain limited to one/second. Account billing access was unavailable to the
current token, so the published plan limits are reference values only, not an
assertion of the account's remaining included quota or invoice.

## Existing memory behavior

Read-only management snapshot at `2026-09-24T03:24:27.069Z`. Instance
`6c169ce2-dc8d-495c-b268-1ff4a5bf1e9f`, version `1.14.3`, started
`2026-09-24T01:30:01.111Z`, uptime 6,865,957 ms.

- Process RSS 342,102,016 bytes; heapUsed 75,895,613 bytes; estimated payload
  61,579 bytes against 8,388,608 bytes (0.73%). Last sixty-minute samples
  peaked at 60,875 bytes (0.73%) and six pending views.
- Since process start: site-stats 112 hits / 27 misses; forum-summary 0 / 0;
  thread-count 63 / 32; home-display 59 hits / 7 misses.
- The last retained v1.14.3 snapshot at 01:37:55 UTC reported home-display
  `loadErrors: 0`. The current snapshot reports cumulative
  `loadErrors: 7` on home-display. The management contract exposes load errors
  as a single cumulative counter without per-error attribution; the cause is
  not classified. No false causality is asserted. site-stats, forum-summary and
  thread-count all report `loadErrors: 0`.
- The forum-list memory family planned for v1.14.4 is not present on
  production; the four active families are site-stats, forum-summary,
  thread-count and home-display.
- Latest successful statistics flush: `2026-09-24T03:20:01.271Z`; zero
  unconfirmed views, dropped views or dropped activities. Buffers hold 4
  pending threads, 11 pending views and 7 pending users; the oldest pending
  entry is `2026-09-24T03:18:09.091Z`. Pending data remained bounded.
- The home-display family remains at one entry against a ceiling of four.
  Load errors and cache misses are separate counters; their equal values do
  not establish a miss failure rate.

## Comparison to prior retained baselines

Document 30 (pre-v1.14.2 full-day) reports 6.47 KV reads/Worker request and
0.505 KV writes/Worker request over 24 hours. Document 32 (pre-v1.14.3 two-hour
forum-zone) reports 8.374 KV reads/Worker request and 0.341 KV writes/Worker
request over 2 hours. The clean 1h30m pre-v1.14.4 sample sits at 8.603 reads
and 0.302 writes per Worker request. These windows are different lengths and
different traffic mixes; no causal savings claim is made. The shorter window
cannot stand in for a full-day baseline.

The retained v1.14.3 release reported 884 Worker requests with zero execution
errors during the 01:16-01:31 rollout window and 2,498 forum HTTP requests
with zero 5xx; the new v1.14.4 clean window contains ≈7× the Worker requests
and ≈5× the forum HTTP requests of that rollout. Worker execution errors remain
zero, while three forum-zone origin timeouts are now observed outside `/`.

The new `home-display` cumulative loadErrors (7) differs from the last retained
zero-error sample.
The cause is not classified; no operational failure or expected auth rejection
is asserted from this single cumulative number. The retained sparse Docker log
sample for ellie-web does not classify the cause.

## Rollout and comparison procedure

1. Synchronize first-party versions to `1.14.4`, preserve dependency
   resolution, update the changelog and pass normal commit/push hooks.
2. Deploy Worker through migration-first `bun run worker:deploy` before
   Web/Admin cutover. No new D1 migration or secret is required.
3. Push the reviewed release commit and tag, verify its exact CI and
   subsequent Docker Release run, and publish the matching GitHub Release.
4. Verify all live versions, Worker deployment ID and Docker image revision
   after cutover. Observe natural traffic warming `forum-list` (new), verify
   both display families remain within their family limits and the shared
   8 MiB payload limit, and confirm another successful timed statistics flush.
5. Compare a complete fifteen-minute post-cutover window after analytics lag
   against the preserved 03:00-03:15 UTC baseline; report totals and
   per-request rates together, with HTTP errors, D1 work, cache headroom and
   any new `home-display` / `forum-list` load errors. The forum-list family
   will be a new observation row in the post-release contract.

The GitHub Release receipt records final rollout times, exact commit/tag/run
IDs and post-release measurements without rewriting this pre-release baseline.
Local raw receipts use `/tmp/ellie-1.14.4-before-*` for this rollout.
