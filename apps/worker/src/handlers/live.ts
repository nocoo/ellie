// Health check handler for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

/**
 * GET /api/live - Health check endpoint.
 *
 * Probes core dependencies (D1) and returns system status.
 * - Not protected by auth
 * - Not cached (Cache-Control: no-store)
 * - Lightweight — only runs `SELECT 1` against D1
 * - Error responses never contain "ok" (prevents keyword monitor false positives)
 */
export async function live(_request: Request, env: Env): Promise<Response> {
	const timestamp = Date.now();
	let d1Status = "connected";
	let healthy = true;

	// Probe D1 connectivity with the lightest possible query
	try {
		await env.DB.prepare("SELECT 1 AS probe").first();
	} catch (err) {
		healthy = false;
		const message = err instanceof Error ? err.message : String(err);
		// Strip any accidental "ok" from error messages to prevent monitor false positives
		d1Status = `unreachable: ${message.replace(/\bok\b/gi, "***")}`;
	}

	const body = {
		status: healthy ? "ok" : "error",
		environment: env.ENVIRONMENT,
		timestamp,
		checks: {
			d1: d1Status,
		},
	};

	return new Response(JSON.stringify(body), {
		status: healthy ? 200 : 503,
		headers: {
			...corsHeaders(),
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}
