import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-api", () => ({
	adminApi: { get: vi.fn() },
}));

import { adminApi } from "@/lib/admin-api";
import { fetchDashboardActivity, fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

const mockGet = adminApi.get as ReturnType<typeof vi.fn>;

describe("dashboard.server", () => {
	it("preserves available activity when a source fails", async () => {
		mockGet.mockImplementation((path: string) =>
			path.endsWith("visits")
				? Promise.reject(new Error("Unavailable"))
				: Promise.resolve({ data: { totalAttempts: 10 } }),
		);
		const activity = await fetchDashboardActivity();
		expect(activity.visits).toBeNull();
		expect(activity.logins?.totalAttempts).toBe(10);
	});
	it("fetchDashboardStats calls adminApi.get", async () => {
		mockGet.mockResolvedValue({
			data: {
				users: { total: 100 },
				threads: { total: 50 },
				posts: { total: 300 },
				source: "stored-counters",
				observedAt: 1,
			},
		});
		const stats = await fetchDashboardStats();
		expect(mockGet).toHaveBeenCalledWith("/api/admin/stats");
		expect(stats.users.total).toBe(100);
	});
});

describe("settings.server", () => {
	it("fetchSettingsDetailed calls adminApi.get without prefix", async () => {
		mockGet.mockResolvedValue({ data: {} });
		await fetchSettingsDetailed();
		expect(mockGet).toHaveBeenCalledWith("/api/admin/settings");
	});

	it("fetchSettingsDetailed encodes prefix", async () => {
		mockGet.mockResolvedValue({ data: {} });
		await fetchSettingsDetailed("general.site");
		expect(mockGet).toHaveBeenCalledWith("/api/admin/settings?prefix=general.site");
	});
});
