import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserCheckins, setCheckinDay } from "../../../../src/handlers/admin/checkin";
import { getTodayLoginsList } from "../../../../src/handlers/admin/loginHistory";
import {
	getById as getReport,
	list as listReports,
	update as updateReport,
} from "../../../../src/handlers/admin/report";
import { handleStats } from "../../../../src/handlers/admin/stats";
import {
	adminReportCacheKey,
	getAdminReport,
	isAdminReportCacheData,
	rebuildAdminReportCache,
	shanghaiStart,
	validateAdminReportDescriptor,
} from "../../../../src/lib/cache/admin-report-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
const DATE = "2026-09-17";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T04:00:00Z"));
	f = readingFixture();
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});

function display(params: CacheDescriptor["params"]): CacheDescriptor {
	return { family: "admin:display", scope: "admin", params };
}
function analytics(params: CacheDescriptor["params"]): CacheDescriptor {
	return { family: "admin:analytics", scope: "admin", params };
}

function seedReport(id: number, overrides: Record<string, string | number> = {}) {
	f.insert("reports", {
		id,
		type: "post",
		target_id: 1,
		reporter_id: 10,
		reporter_name: "alice",
		reason: "spam",
		status: "pending",
		handler_name: "",
		created_at: id,
		...overrides,
	});
}
function seedLogin(id: number, overrides: Record<string, string | number | null> = {}) {
	f.insert("login_history", {
		id,
		user_id: 10,
		username: "alice",
		ok: 1,
		kind: "login",
		error_code: "",
		ip: "1.2.3.4",
		user_agent: "Mozilla/5.0",
		bot_class: "human",
		created_at: shanghaiStart(DATE) + 100 - id,
		...overrides,
	});
}

async function hot(descriptor: CacheDescriptor) {
	const first = await getAdminReport(f.env, undefined, descriptor);
	const cold = f.calls.length;
	expect(cold).toBeGreaterThan(0);
	f.calls.length = 0;
	expect(await getAdminReport(f.env, undefined, descriptor)).toEqual(first);
	expect(f.calls).toHaveLength(0);
	return { first, cold };
}

describe("admin report cache keys and rebuild", () => {
	it("derives keys from exact dimensions without D1", async () => {
		const a = display({
			resource: "reports",
			operation: "list",
			status: null,
			type: null,
			reporterId: null,
			page: 1,
			limit: 20,
		});
		const b = display({
			resource: "reports",
			operation: "list",
			status: "pending",
			type: null,
			reporterId: null,
			page: 1,
			limit: 20,
		});
		const ka = await adminReportCacheKey(f.env, a);
		expect(f.calls).toHaveLength(0);
		expect(ka).toMatch(/^cache:v3:admin:display:/);
		expect(await adminReportCacheKey(f.env, b)).not.toBe(ka);
		await expect(
			adminReportCacheKey(
				f.env,
				display({
					resource: "reports",
					operation: "list",
					status: null,
					type: null,
					reporterId: null,
					page: 1,
					limit: 20,
					extra: 1,
				}),
			),
		).rejects.toThrow(/dimensions/);
		await expect(
			rebuildAdminReportCache(f.env, undefined, {
				...a,
				params: { ...a.params, limit: "20 OFFSET 0" },
			}),
		).rejects.toThrow();
		expect(f.calls).toHaveLength(0);
	});

	it("MEDIUM keys include stats:reports:gen and rebuild never writes KV", async () => {
		const d = analytics({
			resource: "analytics",
			operation: "trend",
			date: DATE,
			metric: "users",
			range: "7d",
		});
		const before = await adminReportCacheKey(f.env, d);
		await f.env.KV.put("stats:reports:gen", "gen-2");
		expect(await adminReportCacheKey(f.env, d)).not.toBe(before);
		expect(f.calls).toHaveLength(0);
		expect(
			((await rebuildAdminReportCache(f.env, undefined, d)) as { series: unknown[] }).series,
		).toHaveLength(7);
		expect([...f.values.keys()].every((key) => !key.startsWith("cache:v3:"))).toBe(true);
	});
});

describe("custom display reads", () => {
	it("caches report list/detail, empty SHORT lists, and distinct filters", async () => {
		seedReport(1, { status: "pending", type: "post" });
		seedReport(2, { status: "resolved", type: "thread", target_id: 1 });
		const list = display({
			resource: "reports",
			operation: "list",
			status: "pending",
			type: null,
			reporterId: null,
			page: 1,
			limit: 20,
		});
		const empty = display({
			resource: "reports",
			operation: "list",
			status: "dismissed",
			type: null,
			reporterId: null,
			page: 1,
			limit: 20,
		});
		const { first, cold } = await hot(list);
		expect(cold).toBe(2);
		expect((first as { items: Array<{ id: number }> }).items.map((row) => row.id)).toEqual([1]);
		const vacant = await hot(empty);
		expect((vacant.first as { items: unknown[] }).items).toEqual([]);
		expect(
			f
				.snapshots("admin:display")
				.some(
					(row) =>
						row.tier === "SHORT" &&
						Array.isArray((row.data as { items?: unknown[] }).items) &&
						(row.data as { items: unknown[] }).items.length === 0,
				),
		).toBe(true);
		const detail = await hot(display({ resource: "reports", operation: "detail", id: 2 }));
		expect((detail.first as { type: string; targetTitle: string | null }).type).toBe("thread");
		expect(
			await getAdminReport(
				f.env,
				undefined,
				display({ resource: "reports", operation: "detail", id: 99 }),
			),
		).toBeNull();
		f.calls.length = 0;
		expect(
			await getAdminReport(
				f.env,
				undefined,
				display({ resource: "reports", operation: "detail", id: 99 }),
			),
		).toBeNull();
		expect(f.calls).toHaveLength(0);
	});

	it("keeps detail lists SHORT, KPI snapshots MEDIUM, and masks IPs", async () => {
		f.thread(1);
		seedLogin(1);
		seedLogin(2, { ok: 0, ip: "2001:db8:cafe::1", error_code: "INVALID_CREDENTIALS" });
		f.insert("analytics_daily_targets", {
			date_local: DATE,
			path_kind: "thread",
			target_id: 1,
			user_id: 10,
			bot_class: "human",
			count: 4,
			first_seen_at: 1,
			last_seen_at: 2,
		});
		f.insert("user_checkins", {
			user_id: 10,
			total_days: 3,
			month_days: 2,
			streak_days: 1,
			reward_total: 0,
			last_reward: 0,
			mood: "",
			message: "",
			last_checkin_at: 1,
		});
		f.insert("checkin_history", {
			user_id: 10,
			date_local: DATE,
			mood: "",
			message: "",
			reward: 0,
			created_at: 1,
		});
		f.insert("admin_logs", {
			id: 1,
			admin_id: 1,
			admin_name: "admin",
			action: "ban_user",
			target_type: "user",
			target_id: 10,
			details: "{}",
			ip: "9.8.7.6",
			created_at: 10,
		});
		const logins = await hot(
			display({
				resource: "logins",
				operation: "list",
				date: DATE,
				ok: null,
				kind: null,
				errorCode: null,
				page: 1,
				limit: 20,
			}),
		);
		expect((logins.first as { rows: Array<{ ip: string }> }).rows.map((row) => row.ip)).toEqual([
			"1.2.x.x",
			"2001:db8::x",
		]);
		expect(JSON.stringify(f.snapshots("admin:display"))).not.toMatch(
			/1\.2\.3\.4|9\.8\.7\.6|2001:db8:cafe::1/,
		);
		await hot(analytics({ resource: "logins", operation: "kpi", date: DATE }));
		await hot(
			display({ resource: "checkins", operation: "user", userId: 10, from: DATE, to: DATE }),
		);
		await hot(analytics({ resource: "stats", operation: "totals" }));
		const logs = await hot(
			display({
				resource: "admin-logs",
				operation: "list",
				adminId: null,
				action: null,
				targetType: null,
				targetId: null,
				startDate: null,
				endDate: null,
				page: 1,
				limit: 20,
			}),
		);
		expect((logs.first as { items: Array<{ ip: string }> }).items[0].ip).toBe("9.8.x.x");
		const otherPage = display({
			resource: "logins",
			operation: "list",
			date: DATE,
			ok: null,
			kind: null,
			errorCode: null,
			page: 2,
			limit: 20,
		});
		expect(await adminReportCacheKey(f.env, otherPage)).not.toBe(
			await adminReportCacheKey(
				f.env,
				display({
					resource: "logins",
					operation: "list",
					date: DATE,
					ok: null,
					kind: null,
					errorCode: null,
					page: 1,
					limit: 20,
				}),
			),
		);
	});

	it("caches analytics date-range aggregates as MEDIUM", async () => {
		const trend7 = analytics({
			resource: "analytics",
			operation: "trend",
			date: DATE,
			metric: "posts",
			range: "7d",
		});
		const trend30 = analytics({
			resource: "analytics",
			operation: "trend",
			date: DATE,
			metric: "posts",
			range: "30d",
		});
		const { first } = await hot(trend7);
		expect((first as { series: unknown[] }).series).toHaveLength(7);
		expect(f.snapshots("admin:analytics")[0].tier).toBe("MEDIUM");
		expect(await adminReportCacheKey(f.env, trend30)).not.toBe(
			await adminReportCacheKey(f.env, trend7),
		);
		await hot(
			analytics({ resource: "analytics", operation: "forum-dist", date: DATE, range: "7d" }),
		);
		await hot(
			analytics({ resource: "analytics", operation: "checkin-trend", date: DATE, range: "90d" }),
		);
		await hot(analytics({ resource: "analytics", operation: "overview", date: DATE }));
	});
});

describe("live handlers, auth gates, failures", () => {
	it("preserves no-store envelopes and does not cache writes or purged users", async () => {
		seedReport(5, { status: "pending" });
		f.thread(1);
		f.post(1);
		const listed = await listReports(createAdminRequest("GET", "/api/admin/reports"), f.env, f.ctx);
		expect(listed.headers.get("Cache-Control")).toBe("no-store, private");
		const body = (await listed.json()) as { data: Array<{ id: number }>; meta: { total: number } };
		expect(body.data[0].id).toBe(5);
		expect(body.meta.total).toBe(1);
		f.calls.length = 0;
		const again = await listReports(createAdminRequest("GET", "/api/admin/reports"), f.env, f.ctx);
		expect(again.headers.get("Cache-Control")).toBe("no-store, private");
		expect(f.calls.filter((call) => call.sql.includes("FROM reports"))).toHaveLength(0);
		const missing = await getReport(
			createAdminRequest("GET", "/api/admin/reports/404"),
			f.env,
			f.ctx,
		);
		expect(missing.status).toBe(404);
		const updated = await updateReport(
			createAdminRequest("PATCH", "/api/admin/reports/5", {
				status: "resolved",
				handlerId: 1,
				handlerName: "admin",
			}),
			f.env,
		);
		expect(updated.status).toBe(200);
		expect(f.calls.some((call) => call.sql.includes("UPDATE reports"))).toBe(true);
		expect(
			(await handleStats(createAdminRequest("GET", "/api/admin/stats"), f.env, f.ctx)).headers.get(
				"Cache-Control",
			),
		).toBe("no-store, private");
		const logins = await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list"),
			f.env,
			f.ctx,
		);
		expect(logins.status).toBe(200);
		expect(((await logins.json()) as { data: { rows: unknown[] } }).data.rows).toEqual([]);
		f.sqlite.prepare("UPDATE users SET status = -99 WHERE id = 10").run();
		expect(
			(
				await getUserCheckins(
					createAdminRequest("GET", "/api/admin/users/10/checkins"),
					f.env,
					f.ctx,
				)
			).status,
		).toBe(409);
		expect(
			(
				await setCheckinDay(
					createAdminRequest("PATCH", "/api/admin/users/10/checkins/2026-09-17", {
						checkedIn: true,
					}),
					f.env,
				)
			).status,
		).toBe(409);
	});

	it("does not cache D1 failures or invalid rebuild input", async () => {
		f.state.queryError = true;
		await expect(
			getAdminReport(
				f.env,
				undefined,
				display({
					resource: "reports",
					operation: "list",
					status: null,
					type: null,
					reporterId: null,
					page: 1,
					limit: 20,
				}),
			),
		).rejects.toThrow();
		await expect(
			getAdminReport(
				f.env,
				undefined,
				analytics({ resource: "analytics", operation: "overview", date: DATE }),
			),
		).rejects.toThrow("Analytics overview could not be loaded");
		expect(f.snapshots("admin:display")).toHaveLength(0);
		f.state.queryError = false;
		f.state.readError = true;
		seedReport(8);
		const recovered = await getAdminReport(
			f.env,
			undefined,
			display({ resource: "reports", operation: "detail", id: 8 }),
		);
		expect((recovered as { id: number }).id).toBe(8);
		await expect(
			rebuildAdminReportCache(
				f.env,
				undefined,
				analytics({
					resource: "analytics",
					operation: "trend",
					date: DATE,
					metric: "users",
					range: "1d",
				}),
			),
		).rejects.toThrow();
	});

	it("shares live shape validation with manager inspect", async () => {
		seedReport(3);
		const list = display({
			resource: "reports",
			operation: "list",
			status: null,
			type: null,
			reporterId: null,
			page: 1,
			limit: 20,
		});
		expect(validateAdminReportDescriptor(list).family).toBe("admin:display");
		const data = await getAdminReport(f.env, undefined, list);
		expect(isAdminReportCacheData(list, data)).toBe(true);
		expect(isAdminReportCacheData(list, { ...(data as object), items: [{ id: 3 }] })).toBe(false);
		const logins = display({
			resource: "logins",
			operation: "list",
			date: DATE,
			ok: null,
			kind: null,
			errorCode: null,
			page: 1,
			limit: 20,
		});
		expect(
			isAdminReportCacheData(logins, {
				page: 1,
				limit: 20,
				total: 1,
				rows: [
					{
						id: 1,
						userId: 10,
						username: "a",
						ok: 1,
						kind: "login",
						errorCode: "",
						ip: "1.2.3.4",
						userAgent: "x",
						botClass: "human",
						createdAt: 1,
					},
				],
			}),
		).toBe(false);
		expect(
			isAdminReportCacheData(display({ resource: "reports", operation: "detail", id: 3 }), null),
		).toBe(true);
		expect(
			validateAdminReportDescriptor(
				analytics({
					resource: "analytics",
					operation: "trend",
					date: DATE,
					metric: "posts",
					range: "7d",
				}),
			).family,
		).toBe("admin:analytics");
	});
});
