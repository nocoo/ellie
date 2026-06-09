import { describe, expect, it } from "vitest";
import { activeForums, parseDashboardStats } from "@/viewmodels/admin/dashboard";

describe("dashboard", () => {
	describe("parseDashboardStats", () => {
		it("parses complete data", () => {
			const raw = {
				users: { total: 100, today: 5, banned: 3 },
				threads: { total: 500, today: 10 },
				posts: { total: 3000, today: 50 },
				forums: { total: 20, hidden: 2 },
			};
			const result = parseDashboardStats(raw);
			expect(result.users.total).toBe(100);
			expect(result.users.today).toBe(5);
			expect(result.users.banned).toBe(3);
			expect(result.threads.total).toBe(500);
			expect(result.posts.today).toBe(50);
			expect(result.forums.hidden).toBe(2);
		});

		it("provides defaults for missing fields", () => {
			const raw = { users: { total: 10 } };
			const result = parseDashboardStats(raw);
			expect(result.users.today).toBe(0);
			expect(result.users.banned).toBe(0);
			expect(result.threads.total).toBe(0);
			expect(result.posts.total).toBe(0);
			expect(result.forums.total).toBe(0);
		});

		it("handles null input", () => {
			const result = parseDashboardStats(null);
			expect(result.users.total).toBe(0);
			expect(result.threads.total).toBe(0);
			expect(result.posts.total).toBe(0);
			expect(result.forums.total).toBe(0);
		});

		it("handles undefined input", () => {
			const result = parseDashboardStats(undefined);
			expect(result.users.total).toBe(0);
		});
	});

	describe("activeForums", () => {
		it("computes total - hidden", () => {
			const stats = parseDashboardStats({
				users: { total: 0, today: 0, banned: 0 },
				threads: { total: 0, today: 0 },
				posts: { total: 0, today: 0 },
				forums: { total: 20, hidden: 3 },
			});
			expect(activeForums(stats)).toBe(17);
		});
	});
});
