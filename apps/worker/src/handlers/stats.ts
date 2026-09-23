import { loadPublicStats } from "../lib/cache/public-stats-read";
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
	_ctx?: ExecutionContext,
): Promise<Response> {
	return jsonResponse(await loadPublicStats(env), request.headers.get("Origin") ?? undefined);
}
