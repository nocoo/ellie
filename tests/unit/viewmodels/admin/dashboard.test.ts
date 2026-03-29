import { describe, expect, it } from "bun:test";
import {
	activeForums,
	parseDashboardStats,
} from "../../../../apps/web/src/viewmodels/admin/dashboard";

describe("parseDashboardStats", () => {
	it("parses complete data", () => {
		const raw = {
			users: { total: 1234, today: 5, banned: 12 },
			threads: { total: 5678, today: 23 },
			posts: { total: 34567, today: 89 },
			forums: { total: 213, hidden: 3 },
		};
		const stats = parseDashboardStats(raw);
		expect(stats.users.total).toBe(1234);
		expect(stats.users.today).toBe(5);
		expect(stats.users.banned).toBe(12);
		expect(stats.threads.total).toBe(5678);
		expect(stats.threads.today).toBe(23);
		expect(stats.posts.total).toBe(34567);
		expect(stats.posts.today).toBe(89);
		expect(stats.forums.total).toBe(213);
		expect(stats.forums.hidden).toBe(3);
	});

	it("defaults missing fields to 0", () => {
		const stats = parseDashboardStats({});
		expect(stats.users.total).toBe(0);
		expect(stats.users.today).toBe(0);
		expect(stats.users.banned).toBe(0);
		expect(stats.threads.total).toBe(0);
		expect(stats.posts.total).toBe(0);
		expect(stats.forums.total).toBe(0);
		expect(stats.forums.hidden).toBe(0);
	});

	it("handles null input", () => {
		const stats = parseDashboardStats(null);
		expect(stats.users.total).toBe(0);
		expect(stats.forums.hidden).toBe(0);
	});

	it("handles undefined input", () => {
		const stats = parseDashboardStats(undefined);
		expect(stats.users.total).toBe(0);
	});

	it("handles partial data (some entities present)", () => {
		const raw = {
			users: { total: 100 },
			forums: { total: 50, hidden: 2 },
		};
		const stats = parseDashboardStats(raw);
		expect(stats.users.total).toBe(100);
		expect(stats.users.today).toBe(0);
		expect(stats.users.banned).toBe(0);
		expect(stats.threads.total).toBe(0);
		expect(stats.posts.total).toBe(0);
		expect(stats.forums.total).toBe(50);
		expect(stats.forums.hidden).toBe(2);
	});
});

describe("activeForums", () => {
	it("computes total - hidden", () => {
		const stats = parseDashboardStats({
			users: { total: 0, today: 0, banned: 0 },
			threads: { total: 0, today: 0 },
			posts: { total: 0, today: 0 },
			forums: { total: 213, hidden: 3 },
		});
		expect(activeForums(stats)).toBe(210);
	});

	it("returns 0 when all forums are hidden", () => {
		const stats = parseDashboardStats({
			forums: { total: 5, hidden: 5 },
		});
		expect(activeForums(stats)).toBe(0);
	});

	it("returns total when none are hidden", () => {
		const stats = parseDashboardStats({
			forums: { total: 100, hidden: 0 },
		});
		expect(activeForums(stats)).toBe(100);
	});
});
