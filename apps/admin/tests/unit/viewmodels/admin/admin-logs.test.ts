import {
	buildAdminLogSearchParams,
	dateInputToUnix,
	formatLogTime,
	formatTarget,
	parseDetails,
	targetHref,
} from "@/viewmodels/admin/admin-logs";
import { describe, expect, it } from "vitest";

describe("admin-logs viewmodel", () => {
	describe("buildAdminLogSearchParams", () => {
		it("forwards page and limit", () => {
			const params = buildAdminLogSearchParams({ page: 2, limit: 50 });
			expect(params.page).toBe(2);
			expect(params.limit).toBe(50);
		});

		it("includes action / targetType when set", () => {
			const params = buildAdminLogSearchParams({ action: "user.ban", targetType: "user" });
			expect(params.action).toBe("user.ban");
			expect(params.targetType).toBe("user");
		});

		it("omits empty action / targetType strings", () => {
			const params = buildAdminLogSearchParams({ action: "", targetType: "" });
			expect(params.action).toBeUndefined();
			expect(params.targetType).toBeUndefined();
		});

		it("forwards numeric ids and date bounds verbatim", () => {
			const params = buildAdminLogSearchParams({
				adminId: 1,
				targetId: 3,
				startDate: 100,
				endDate: 200,
			});
			expect(params.adminId).toBe(1);
			expect(params.targetId).toBe(3);
			expect(params.startDate).toBe(100);
			expect(params.endDate).toBe(200);
		});
	});

	describe("parseDetails", () => {
		it("returns ok for valid JSON", () => {
			const result = parseDetails('{"a":1}');
			expect(result).toEqual({ ok: true, value: { a: 1 } });
		});

		it("returns ok for arrays", () => {
			const result = parseDetails("[1,2,3]");
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value).toEqual([1, 2, 3]);
		});

		it("returns raw fallback for non-JSON text", () => {
			const result = parseDetails("not json at all");
			expect(result).toEqual({ ok: false, raw: "not json at all" });
		});

		it("falls back gracefully on null / undefined", () => {
			expect(parseDetails(null)).toEqual({ ok: false, raw: "" });
			expect(parseDetails(undefined)).toEqual({ ok: false, raw: "" });
		});

		it("falls back gracefully on empty / whitespace-only string", () => {
			expect(parseDetails("")).toEqual({ ok: false, raw: "" });
			expect(parseDetails("   \n\t ")).toEqual({ ok: false, raw: "" });
		});
	});

	describe("targetHref", () => {
		it("links user → /admin/users/{id}", () => {
			expect(targetHref("user", 7)).toBe("/admin/users/7");
		});
		it("links thread → /admin/threads/{id}", () => {
			expect(targetHref("thread", 42)).toBe("/admin/threads/42");
		});
		it("links report → /admin/reports?id={id} (no detail route yet)", () => {
			expect(targetHref("report", 9)).toBe("/admin/reports?id=9");
		});
		it("links forum → /admin/forums (list, no per-row detail)", () => {
			expect(targetHref("forum", null)).toBe("/admin/forums");
			expect(targetHref("forum", 5)).toBe("/admin/forums");
		});
		it("returns null for non-whitelisted types", () => {
			expect(targetHref("post", 1)).toBeNull();
			expect(targetHref("attachment", 1)).toBeNull();
			expect(targetHref("ip_ban", 1)).toBeNull();
			expect(targetHref("censor_word", 1)).toBeNull();
			expect(targetHref("announcement", 1)).toBeNull();
			expect(targetHref("setting", null)).toBeNull();
			expect(targetHref("", null)).toBeNull();
		});
		it("returns null for whitelisted types missing id (except forum)", () => {
			expect(targetHref("user", null)).toBeNull();
			expect(targetHref("thread", null)).toBeNull();
			expect(targetHref("report", null)).toBeNull();
		});
	});

	describe("formatTarget", () => {
		it("renders type#id when both present", () => {
			expect(formatTarget("user", 3)).toBe("user#3");
		});
		it("renders just type when id is null", () => {
			expect(formatTarget("setting", null)).toBe("setting");
		});
		it("returns empty for empty type", () => {
			expect(formatTarget("", null)).toBe("");
		});
	});

	describe("formatLogTime", () => {
		it("returns empty string for 0", () => {
			expect(formatLogTime(0)).toBe("");
		});
		it("returns a non-empty locale string for a real timestamp", () => {
			const out = formatLogTime(1704067200);
			expect(out).toBeTruthy();
			expect(out).not.toBe("0");
		});
	});

	describe("dateInputToUnix", () => {
		it("returns undefined for empty string", () => {
			expect(dateInputToUnix("", "start")).toBeUndefined();
			expect(dateInputToUnix("", "end")).toBeUndefined();
		});
		it("returns undefined for malformed input", () => {
			expect(dateInputToUnix("2026/05/05", "start")).toBeUndefined();
			expect(dateInputToUnix("not-a-date", "end")).toBeUndefined();
		});
		it("start bound is local 00:00:00 of given day", () => {
			const ts = dateInputToUnix("2026-05-05", "start");
			expect(ts).toBeDefined();
			const d = new Date((ts as number) * 1000);
			expect(d.getFullYear()).toBe(2026);
			expect(d.getMonth()).toBe(4);
			expect(d.getDate()).toBe(5);
			expect(d.getHours()).toBe(0);
			expect(d.getMinutes()).toBe(0);
			expect(d.getSeconds()).toBe(0);
		});
		it("end bound is local 23:59:59 of given day", () => {
			const ts = dateInputToUnix("2026-05-05", "end");
			expect(ts).toBeDefined();
			const d = new Date((ts as number) * 1000);
			expect(d.getHours()).toBe(23);
			expect(d.getMinutes()).toBe(59);
			expect(d.getSeconds()).toBe(59);
		});
		it("end bound is strictly greater than start bound for the same day", () => {
			const start = dateInputToUnix("2026-05-05", "start") as number;
			const end = dateInputToUnix("2026-05-05", "end") as number;
			expect(end).toBeGreaterThan(start);
			// roughly 24h - 1s
			expect(end - start).toBeGreaterThan(86_000);
			expect(end - start).toBeLessThan(86_400);
		});
	});
});
