// Next.js instrumentation — runs once on server startup.
//
// Keeps the Cloudflare Worker fetch handler warm by pinging it every 60s.
// Without this, the Worker isolate is evicted after ~10-30s of no HTTP
// traffic, causing 1.5-2s cold starts on the next real request.
//
// The existing wrangler cron (every 5 min) only warms the `scheduled`
// handler, which runs in a separate isolate from `fetch`.

export async function register() {
	const workerUrl = process.env.WORKER_API_URL;
	const apiKey = process.env.FORUM_API_KEY;

	// Skip during build (placeholder values) or when env is missing
	if (!workerUrl || !apiKey || workerUrl.includes("placeholder")) return;

	const pingUrl = `${workerUrl.replace(/\/+$/, "")}/api/v1/settings?prefix=feat.`;

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

	// Periodic keepalive every 60s to prevent isolate eviction.
	setInterval(ping, 60_000);

	console.log("[instrumentation] Worker keepalive armed (60s interval)");
}
