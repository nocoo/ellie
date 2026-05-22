// Admin stats handler — #61 GET /api/admin/stats
import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
const statsConfig: EntityConfig = {
	table: "",
	entityName: "STATS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

async function getStats(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const todayUtc = Math.floor(Date.now() / 1000 / 86400) * 86400;

	const results = await env.DB.batch([
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users"),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users WHERE reg_date >= ?").bind(todayUtc),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users WHERE status = -1"),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads"),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads WHERE created_at >= ?").bind(todayUtc),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts"),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ?").bind(todayUtc),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM forums"),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM forums WHERE status = 0"),
	]);

	const count = (i: number) => (results[i].results[0] as Record<string, number>).cnt;

	return jsonNoStoreResponse(
		{
			users: { total: count(0), today: count(1), banned: count(2) },
			threads: { total: count(3), today: count(4) },
			posts: { total: count(5), today: count(6) },
			forums: { total: count(7), hidden: count(8) },
		},
		origin,
	);
}

export const handleStats = withEntityAuth(statsConfig, getStats);
