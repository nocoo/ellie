// Public display snapshots live for 60 seconds. Cumulative counters retain
// their historical semantics; daily counts come from committed post records.
import { getPublicStats } from "../lib/cache/public-stats-read";
import type { CFRequest, Env } from "../lib/env";
import { jsonResponse } from "../lib/response";

export interface PublicStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalPosts: number;
	totalMembers: number;
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

export async function stats(
	request: CFRequest,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	return jsonResponse(await getPublicStats(env, ctx), request.headers.get("Origin") ?? undefined);
}
