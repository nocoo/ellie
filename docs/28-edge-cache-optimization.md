# Edge cache optimization

## Scope and decisions

The approved direction is to serve reusable HTTP responses from Cloudflare before
requests reach Next.js, the data Worker, KV, or D1. Prefer native Cache Rules for
origin responses and Workers Cache for Worker-generated responses. Do not build a
new application cache framework or add more per-entity KV caches.

Phase 1 is authorized for implementation and a patch release after v1.14.0.
Phases 2 and 3 remain proposals for discussion. The existing login requirement,
private responses, current authorization checks, and moderation behavior remain
mandatory throughout.

## Production baseline

Investigated on 2026-09-23 against Worker v1.14.0 and Git v1.14.0. The following
are Cloudflare adaptive analytics for complete UTC days, not final invoice data.

| UTC date | Production KV reads | KV writes | Worker requests |
| --- | ---: | ---: | ---: |
| 2026-09-16 | 116,719 | 9,052 | 62,740 |
| 2026-09-17 | 5,228,834 | 170,008 | 140,568 |
| 2026-09-18 | 5,985,908 | 200,143 | 96,055 |
| 2026-09-19 | 314,914 | 37,623 | 58,119 |
| 2026-09-20 | 358,496 | 38,411 | 74,498 |
| 2026-09-21 | 407,736 | 40,614 | 68,579 |
| 2026-09-22 | 523,214 | 48,613 | 82,289 |

- The unified cache change `4c49b7e0` introduced membership/entity/stat/generation
  fan-out. Forum summaries also expanded the latest thread of each forum.
- `38703ac8` removed that summary expansion. The deployment on September 19
  coincided with hourly reads dropping from approximately 170,000 to 9,380.
  Historical per-family attribution is unavailable; this is not proof that one
  commit explains the entire reduction.
- September 22 KV reads were 57.5% hot, 20.1% cold, and 22.4% not found. Cold-read
  median latency was 266 ms. Missing generation keys are intentional in some
  paths, so not-found is not equivalent to a business-cache miss.
- Avatar-path lookups generated 27,120 Worker requests that day. Approximately
  99.3% of Worker invocations ran in KIX. Requests include analytics and images;
  Worker request count is not page-view count.
- Production has 115 active forums, a list page size of 50, and
  `features.access.require_login=true`.
- Bulk KV reads are billed per key. Increasing KV expiry or `cacheTtl` does not
  eliminate a read when the application still calls `KV.get()`.

## Existing boundaries

- [Forum layout](../apps/web/src/app/(forum)/layout.tsx) is dynamic and includes
  user-specific information. [Forum API](../apps/web/src/lib/forum-api.ts) uses
  `no-store`. Caching the current whole HTML response would mix user state.
- [Thread loaders](../apps/worker/src/lib/cache/thread-loaders.ts) read generation,
  entity, and statistics separately. A warm 50-thread list still reads at least
  150 topic-related keys, before membership and author lookups.
- [Detail loading](../apps/web/src/viewmodels/forum/thread-detail.server.ts)
  fetches posts, attachments, and authors separately. Repeated thread generation
  reads occur within post and attachment batches.
- [Avatar proxy](../apps/web/src/app/api/avatar/[uid]/route.ts) resolves the mutable
  UID mapping through the Worker for each origin request. GUID avatar URLs
  already address immutable images directly.
- The one-hour Next.js forum-summary cache introduced in `8436e415` was removed
  in `d7223963` because it concealed invalidation. Do not restore it without a
  complete freshness and authorization design.

## Phase 1: avatars and static resources

### HTTP behavior

1. Make successful UID avatar responses eligible for a 60-second Cloudflare
   edge cache. Keep browser revalidation, preserve query strings, and do not
   introduce application memory or KV caches. This permits up to 60 seconds of
   additional edge staleness for other readers of a mutable UID URL.
2. Upload success must display the returned GUID image immediately. The uploader
   and shared avatar context use that immutable URL directly instead of looking
   up the UID mapping again. Server-rendered user displays continue to use the
   existing invalidation behavior.
3. Transient Worker, storage, or network failures and fallback images remain
   uncached. Do not turn an outage or a missing image into a long-lived 200.
4. Keep hashed Next.js assets and GUID images long-lived. Give small shared
   assets such as the favicon and theme boot script a bounded edge lifetime.
   Never extend immutable caching to mutable HTML or unversioned user content.

### Cloudflare rules

Use narrowly scoped Cache Rules, matching the exact forum/CDN host and resource
paths. Preserve existing unrelated rules. Mark eligible responses cacheable but
respect their origin/CDN cache headers; do not override `no-store` or cache
errors. The UID avatar query string remains part of the cache key.

- Forum: `/api/avatar/*`, `/_next/static/*`, `/favicon.ico`, `/fouc.js`.
- Image CDN: immutable `/avatars/*` objects; inspect the existing route/rules
  before choosing whether any change is necessary.
- Exclude forum HTML, RSC, authentication, user-private APIs, admin routes, and
  all writes. A Cookie's presence is not proof of authentication.

The Wrangler OAuth token used during investigation cannot read Cache Rules
(403). Use an existing authorized dashboard session or appropriate zone-scoped
credentials. Never broaden credentials or claim that a local configuration is
live. Save the prior rule state before changes and verify the resulting rule IDs.

### Modules and atomic commits

1. Commit this plan and its documentation links.
2. Update `lib/avatar-proxy.ts`, the avatar Route Handler, Worker upload response/metadata,
   `contexts/avatar-context.tsx`, upload consumers, and relevant tests. Allow the exact theme script through the auth proxy; configure
   bounded static-resource headers in `next.config.ts`. Commit the working change.
3. Apply and verify the narrowly scoped Cloudflare rules. Record deployed rules,
   response headers, MISS/HIT evidence, and verification limitations here.
4. Synchronize manifests, Bun/Cargo locks, version exports, and `CHANGELOG.md`;
   release v1.14.1 through normal commit/push hooks, tag, GitHub Release, CI,
   migration-first Worker deployment, and web/admin deployment verification.

### Verification and rollback

- L1: unit tests cover successful edge eligibility, transient-error non-caching,
  distinct upload URLs, and immediate propagation of the saved avatar. Run the
  existing lint/typecheck/coverage gates without lowering thresholds. The
  handbook's existing 95% branch-coverage gap remains explicit.
- L2: run the existing local Worker/API lane through hooks. New shared-data
  endpoints are outside this phase.
- L3/manual: exercise upload propagation locally and inspect deployed anonymous
  avatar/static requests. Do not upload test images to a production user.
- G2: run existing secret/dependency scans. D1: use local disposable fixtures for
  tests; production verification uses bounded read-only requests.
- Confirm repeated identical URLs reach `CF-Cache-Status: HIT` with `Age`,
  while the live/HTML/private routes remain uncached. Distinguish independent
  client/network timings from application benchmarks.
- Rollback removes/disables only the new rule IDs and purges their affected URLs
  if needed. Restore prior headers through a normal corrective release. Do not
  purge an entire zone or move published tags.

## Phase 2: native caching of shared data responses (proposed)

Use Workers Cache for complete reusable responses, not Zone Cache Rules over
Worker-generated JSON and not per-key `caches.default` wrappers. An uncached
outer entrypoint validates the trusted caller and user; an internal cached
entrypoint supplies reusable data. Native tiering, request collapsing, expiry,
and purge should replace application orchestration where possible.

| Data | Initial proposal |
| --- | --- |
| Home forum/digest/stat displays | Shared response, 30–60 seconds |
| Forum lists | Per normalized forum/page/type response, 30–60 seconds |
| Thread pages | Per thread/page content and attachment response, 30–60 seconds |
| Expensive totals/digest aggregates | Retain KV only when measured reuse justifies it |
| Sessions, email verification, rate limits, private messages | Separate; never shared response cache |

Define mutation-driven purge, bounded freshness, and failure behavior before
implementation. Deletion, hiding, anonymity, and current authorization must
still be enforced. A role bucket alone does not encode author-specific access.
Check native purge results and limits; local cache deletion is not global purge.
Do not cache browse-count side effects or user-specific controls. Reusing an
existing snapshot must not restart its freshness lifetime.

Next.js SSR still runs in this phase. Measure the data Worker executions avoided,
not merely the CF HIT count. Workers Cache hits still incur Worker request charges.

## Phase 3: edge delivery of shared page content (proposed)

Separate shared page content from current-user information, then move the
protected shared-read entrypoint to Cloudflare. This allows a browser content
request to finish at the edge without entering Next.js or the data Worker.

Authentication must precede access to cached protected content. HTML and RSC
variants need explicit handling. Decide how immediate permission revocation and
moderation are enforced; zero backend reads cannot be assumed while requiring
fresh authoritative authorization on every request. This is an architectural
change, not a Cache Everything rule.

## Success measurements

Compare cold and warm home/list/thread journeys using actual KV key reads,
origin requests, data Worker executions, D1 rows scanned, TTFB, and P95 latency.
Prioritize route cache hit rate and avoided origin work. Sample diagnostic logs;
do not reintroduce a database write for every cache operation. Phase 1 reports
observed cache behavior, not a projected percentage reduction as a measured result.

## References

- [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/)
- [Workers Cache](https://developers.cloudflare.com/workers/cache/)
- [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Cache API limitations](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)

## Phase 1 execution record

- The original forum ruleset contained one image eligibility rule for `/static/*`
  and `/data/attachment/*`. The image CDN zone had no Cache Rules entrypoint.
  Existing dashboard authorization provides zone access without changing tokens.
- Before this change, anonymous `/fouc.js` requests redirected to login and
  returned HTML. The exact script path is excluded from the authentication proxy;
  script and favicon responses request a one-hour edge TTL with browser revalidation.
- Hashed Next.js assets retain framework-provided immutable headers. New GUID
  avatar objects receive immutable metadata; existing R2 objects are not rewritten.
- Applied forum rule `a61d0c13f901485f8965e1de3adceb30` in ruleset
  `b38bf24040664109a9f0d636e039a736` (version 2), preserving existing rule
  `5858e7b6a8404595b0b98b7398908e73`. Exact host: `bbs.tongji.net`; paths:
  `/api/avatar/*`, `/_next/static/*`, `/favicon.ico`, `/fouc.js`.
  Cache eligibility is enabled, edge TTL uses `bypass_by_default`, browser TTL
  respects origin, and HTTP 300–599 responses are `no-store`. Default query-string
  cache keys are preserved. HTTP method matching is omitted because Cloudflare's
  native caching already limits methods and method filters can interfere with
  single-URL purge.
- No extra rule is needed on `t.no.mt`: JPEG/PNG objects already use native CDN
  caching; new R2 metadata supplies their immutable lifetime.
- Live response verification is pending application deployment.
