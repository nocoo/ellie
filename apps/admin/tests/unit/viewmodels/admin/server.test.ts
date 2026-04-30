import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-api", () => ({
	adminApi: { get: vi.fn() },
}));

import { adminApi } from "@/lib/admin-api";
import { fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

const mockGet = adminApi.get as ReturnType<typeof vi.fn>;

describe("dashboard.server", () => {
	it("fetchDashboardStats calls adminApi.get", async () => {
		mockGet.mockResolvedValue({
			data: {
				users: { total: 100 },
				threads: { total: 50 },
				posts: { total: 300 },
				forums: { total: 10 },
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
