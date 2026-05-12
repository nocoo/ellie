import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		getList: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import { fetchUserCheckins, setCheckinDay, setUserStreak } from "@/viewmodels/admin/user-checkin";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("user-checkin viewmodel", () => {
	it("fetchUserCheckins without range omits searchParams", async () => {
		mockGet.mockResolvedValue({ data: { userId: 1, history: [], range: { from: "x", to: "y" } } });
		await fetchUserCheckins(1);
		expect(mockGet).toHaveBeenCalledWith("/api/admin/users/1/checkins", undefined);
	});

	it("fetchUserCheckins forwards from/to to searchParams", async () => {
		mockGet.mockResolvedValue({ data: {} });
		await fetchUserCheckins(42, { from: "2026-04-01", to: "2026-05-12" });
		expect(mockGet).toHaveBeenCalledWith("/api/admin/users/42/checkins", {
			from: "2026-04-01",
			to: "2026-05-12",
		});
	});

	it("setCheckinDay PATCHes the dateLocal endpoint with checkedIn body", async () => {
		mockPatch.mockResolvedValue({
			data: {
				userId: 42,
				dateLocal: "2026-05-12",
				checkedIn: true,
				recompute: {
					totalDays: 1,
					monthDays: 1,
					streakDays: 1,
					rewardTotal: 0,
					lastCheckinAt: 0,
					historyRows: 1,
					skipped: false,
				},
			},
		});
		const result = await setCheckinDay(42, "2026-05-12", true);
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/users/42/checkins/2026-05-12", {
			checkedIn: true,
		});
		expect(result.checkedIn).toBe(true);
		expect(result.recompute.totalDays).toBe(1);
	});

	it("setCheckinDay supports checkedIn=false", async () => {
		mockPatch.mockResolvedValue({ data: { recompute: {} } });
		await setCheckinDay(42, "2026-05-12", false);
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/users/42/checkins/2026-05-12", {
			checkedIn: false,
		});
	});

	it("setUserStreak PATCHes the streak endpoint with streakDays body", async () => {
		mockPatch.mockResolvedValue({
			data: { userId: 42, streakDays: 7, note: "Manual streak edit will be overwritten" },
		});
		const result = await setUserStreak(42, 7);
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/users/42/checkins/streak", {
			streakDays: 7,
		});
		expect(result.streakDays).toBe(7);
	});
});
