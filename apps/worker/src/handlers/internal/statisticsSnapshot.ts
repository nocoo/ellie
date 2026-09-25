import { DAILY_STATISTICS_MAX_BYTES, STATISTICS_WRITE_HEADER } from "@ellie/types";
import { constantTimeEqualStr } from "../../lib/constant-time";
import { readDailyStatistics, refreshDailyStatistics } from "../../lib/daily-statistics";
import type { Env } from "../../lib/env";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export async function statisticsSnapshotHandler(request: Request, env: Env): Promise<Response> {
	const error = (code: string, status: number) =>
		new Response(JSON.stringify({ error: { code } }), { status, headers: HEADERS });
	if (request.method !== "GET" && request.method !== "POST")
		return error("METHOD_NOT_ALLOWED", 405);
	const key = env.WEB_STATISTICS_WRITE_KEY;
	if (!key) return error("NOT_CONFIGURED", 503);
	const presented = request.headers.get(STATISTICS_WRITE_HEADER) ?? "";
	if (!presented || !constantTimeEqualStr(presented, key)) return error("UNAUTHORIZED", 401);
	try {
		const data =
			request.method === "POST"
				? await refreshDailyStatistics(env)
				: await readDailyStatistics(env);
		const body = JSON.stringify({ data });
		if (new TextEncoder().encode(body).byteLength > DAILY_STATISTICS_MAX_BYTES)
			return error("STATISTICS_UNAVAILABLE", 503);
		return new Response(body, { headers: HEADERS });
	} catch {
		return error("STATISTICS_UNAVAILABLE", 503);
	}
}
