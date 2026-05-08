// Next.js instrumentation — runs once on server startup.
//
// Keeps the Cloudflare Worker fetch handler warm by pinging it
// periodically. Without this, the Worker isolate is evicted after
// ~10-30s of no HTTP traffic, causing 1.5-2s cold starts on the
// next real request.
//
// The existing wrangler cron (every 5 min) only warms the `scheduled`
// handler, which runs in a separate isolate from `fetch`.

// Must be shorter than the observed 10-30s isolate eviction window.
// 10s → ~8,640 requests/day; well within free-tier limits.
const KEEPALIVE_INTERVAL_MS = 10_000;

export async function register() {
	const workerUrl = process.env.WORKER_API_URL;
	const apiKey = process.env.FORUM_API_KEY;

	// Skip during build (placeholder values) or when env is missing
	if (!workerUrl || !apiKey || workerUrl.includes("placeholder")) return;

	const pingUrl = `${workerUrl.replace(/\/+$/, "")}/api/v1/settings?prefix=features.access.`;

	async function ping() {
		try {
			const res = await fetch(pingUrl, {
				headers: { "X-API-Key": apiKey as string },
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) {
				console.warn(`[keepalive] Worker ping returned ${res.status}`);
			}
		} catch {
			// Transient network failure — tolerate silently, next tick retries
		}
	}

	// Initial warmup: hit the Worker immediately so the first real request
	// doesn't pay the cold-start cost.
	ping();

	// Periodic keepalive — .unref() lets the process exit normally when the
	// server shuts down (avoids blocking in non-server contexts like tests).
	const timer = setInterval(ping, KEEPALIVE_INTERVAL_MS);
	if (typeof timer === "object" && "unref" in timer) timer.unref();

	console.log(
		`[instrumentation] Worker keepalive armed (${KEEPALIVE_INTERVAL_MS / 1000}s interval)`,
	);
}
