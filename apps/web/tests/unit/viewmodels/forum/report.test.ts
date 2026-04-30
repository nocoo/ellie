import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
	class ApiError extends Error {
		status: number;
		constructor(m: string, s: number) {
			super(m);
			this.status = s;
		}
	}
	return {
		apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
		ApiError,
	};
});

import { ApiError, apiClient } from "@/lib/api-client";
import { REPORT_REASONS, checkReportPermission, submitReport } from "@/viewmodels/forum/report";

const mockClient = apiClient as any;

describe("REPORT_REASONS", () => {
	it("contains expected reasons", () => {
		expect(REPORT_REASONS.length).toBe(6);
		expect(REPORT_REASONS).toContain("垃圾广告");
		expect(REPORT_REASONS).toContain("其他");
	});
});

describe("checkReportPermission", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns permission data on success", async () => {
		mockClient.get.mockResolvedValue({ data: { allowed: true } });
		const result = await checkReportPermission();
		expect(result).toEqual({ allowed: true });
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission");
	});

	it("returns not allowed with message on ApiError", async () => {
		mockClient.get.mockRejectedValue(new ApiError("Not authenticated", 401));
		const result = await checkReportPermission();
		expect(result).toEqual({ allowed: false, reason: "Not authenticated" });
	});

	it("rethrows non-ApiError", async () => {
		mockClient.get.mockRejectedValue(new Error("network"));
		await expect(checkReportPermission()).rejects.toThrow("network");
	});
});

describe("submitReport", () => {
	beforeEach(() => vi.clearAllMocks());

	it("converts payload format and posts", async () => {
		const apiResult = { id: 1, type: "post", targetId: 100, reason: "垃圾广告", createdAt: 1000 };
		mockClient.post.mockResolvedValue({ data: apiResult });

		const result = await submitReport({ postId: 100, reason: "垃圾广告" });
		expect(result).toEqual(apiResult);
		expect(mockClient.post).toHaveBeenCalledWith("/api/v1/reports", {
			type: "post",
			targetId: 100,
			reason: "垃圾广告",
		});
	});
});
