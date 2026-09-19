import { afterEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	getTodayVisitsKpi,
	getTodayVisitsList,
} from "../../../../src/handlers/admin/todayVisits";
import { memoryFlushSink } from "../../../../src/lib/analytics/flushSink-memory";
import type { AggregateRow } from "../../../../src/lib/analytics/types";
import { memoryFixture } from "../../../analytics-memory-fixture";
import { createAdminRequest, createMockDb } from "../../../helpers";

const date = "2026-09-19";
function row(overrides: Partial<AggregateRow> = {}): AggregateRow {
	return {
		dateLocal: date,
		pathKind: "home",
		targetId: 0,
		userId: 0,
		botClass: "human",
		count: 3,
		firstSeenAt: 100,
		lastSeenAt: 200,
		...overrides,
	};
}
async function fixture() {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-19T01:00:00Z"));
	const f = memoryFixture();
	const db = createMockDb({
		allResults: {
			"SELECT id, subject FROM threads": [{ id: 1, subject: "Topic" }],
			"SELECT id, name FROM forums": [{ id: 2, name: "Board" }],
			"SELECT id, username FROM users": [{ id: 3, username: "Person" }],
		},
	});
	f.env.DB = db.db;
	return { ...f, db };
}
afterEach(() => vi.useRealTimers());

describe("today visits reads shared volatile memory", () => {
	it("keeps day boundaries and the path whitelist", () => {
		expect(_internal.shanghaiDateLocal(Date.parse("2026-09-18T15:59:59Z") / 1000)).toBe(
			"2026-09-18",
		);
		expect(_internal.shanghaiDateLocal(Date.parse("2026-09-18T16:00:00Z") / 1000)).toBe(date);
		expect(_internal.PATH_KIND_VALUES.size).toBe(10);
	});
	it("shows new samples immediately and ignores old persisted KPI snapshots", async () => {
		const { env, db, instances } = await fixture();
		const request = createAdminRequest("GET", "/api/admin/analytics/today/visits");
		await env.KV.put("analytics:today-visits", JSON.stringify({ totalViews: 999 }));
		vi.mocked(env.KV.put).mockClear();
		expect((await (await getTodayVisitsKpi(request, env)).json()).data.totalViews).toBe(0);
		await memoryFlushSink(env, [row(), row({ botClass: "bot_search", count: 5 })]);
		const response = await getTodayVisitsKpi(request, env);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect((await response.json()).data).toMatchObject({
			totalViews: 8,
			humanViews: 3,
			botSearchViews: 5,
			activeUsers: null,
			anonPresent: null,
			dateLocal: date,
		});
		instances.clear();
		expect((await (await getTodayVisitsKpi(request, env)).json()).data.totalViews).toBe(0);
		expect(db.db.prepare).not.toHaveBeenCalled();
		expect(env.KV.put).not.toHaveBeenCalled();
	});
	it("filters and paginates memory totals, looking up labels only for returned targets", async () => {
		const { env, db } = await fixture();
		await memoryFlushSink(env, [
			row({ pathKind: "thread", targetId: 1, count: 9 }),
			row({ pathKind: "forum", targetId: 2, count: 7 }),
			row({ pathKind: "user", targetId: 3, count: 5 }),
			row(),
		]);
		const list = async (query = "") =>
			(
				await (
					await getTodayVisitsList(
						createAdminRequest("GET", `/api/admin/analytics/today/visits/list${query}`),
						env,
					)
				).json()
			).data;
		const all = await list();
		expect(all).toMatchObject({ page: 1, limit: 20, total: 4 });
		expect(all.rows.map((item: { label: string }) => item.label)).toEqual([
			"Topic",
			"Board",
			"Person",
			"",
		]);
		expect(all.rows.every((item: { uniqueUsers: unknown }) => item.uniqueUsers === null)).toBe(
			true,
		);
		expect((await list("?path_kind=forum")).rows).toMatchObject([
			{ targetId: 2, label: "Board", views: 7 },
		]);
		expect((await list("?page=2&limit=1")).rows).toMatchObject([{ pathKind: "forum" }]);
		expect(await list("?page=-2&limit=10000")).toMatchObject({
			page: 1,
			limit: _internal.LIST_PAGE_SIZE_MAX,
		});
		expect(await list("?page=nope&limit=nope")).toMatchObject({
			page: 1,
			limit: _internal.LIST_PAGE_SIZE_DEFAULT,
		});
		expect(await list("?path_kind=&limit=0")).toMatchObject({ limit: 1 });
		expect(db.calls.every((call) => !call.sql.includes("analytics_daily_targets"))).toBe(true);
		expect(env.KV.put).not.toHaveBeenCalled();
	});
	it("rejects an invalid filter before visiting the memory actor", async () => {
		const { env, getByName } = await fixture();
		const response = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list?path_kind=bogus"),
			env,
		);
		expect(response.status).toBe(400);
		expect(getByName).not.toHaveBeenCalled();
	});
	it("fails explicitly when ephemeral storage is unavailable", async () => {
		const { env, db } = await fixture();
		delete env.TODAY_VISITS;
		await expect(
			getTodayVisitsKpi(createAdminRequest("GET", "/api/admin/analytics/today/visits"), env),
		).rejects.toThrow("not configured");
		expect(db.db.prepare).not.toHaveBeenCalled();
	});
});
