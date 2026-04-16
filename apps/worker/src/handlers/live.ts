// Health check handler for Cloudflare Worker
import { VERSION_DISPLAY } from "@ellie/types";
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

const bootedAt = Date.now();

/**
 * GET /api/live - Health check endpoint.
 *
 * Probes core dependencies (D1) and returns system status.
 * - Not protected by auth
 * - Not cached (Cache-Control: no-store)
 * - Lightweight — only runs `SELECT 1` against D1
 * - Error responses never contain "ok" (prevents keyword monitor false positives)
 */
export async function live(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const timestamp = new Date().toISOString();
	const uptime = Math.round((Date.now() - bootedAt) / 1000);
	let database: { connected: boolean; error?: string } = { connected: false };

	// Probe D1 connectivity with the lightest possible query
	try {
		await env.DB.prepare("SELECT 1 AS probe").first();
		database = { connected: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Strip any accidental "ok" from error messages to prevent monitor false positives
		database = {
			connected: false,
			error: message.replace(/\bok\b/gi, "***"),
		};
	}

	const healthy = database.connected;

	const body = {
		status: healthy ? "ok" : "error",
		version: VERSION_DISPLAY,
		component: "ellie-worker",
		timestamp,
		uptime,
		database,
	};

	return new Response(JSON.stringify(body), {
		status: healthy ? 200 : 503,
		headers: {
			...corsHeaders(origin),
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}
