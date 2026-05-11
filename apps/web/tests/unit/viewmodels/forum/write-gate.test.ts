// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
	class ApiError extends Error {
		status: number;
		code: string;
		constructor(m: string, s: number, code = "") {
			super(m);
			this.status = s;
			this.code = code;
		}
	}
	return {
		apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
		ApiError,
	};
});

import { ApiError, apiClient } from "@/lib/api-client";
import {
	WRITE_GATE_EVENT,
	checkWriteGate,
	codeToCtaLabel,
	codeToRedirect,
	dispatchWriteGate,
	invalidateWriteGateCache,
	writeGatePreflight,
} from "@/viewmodels/forum/write-gate";

const mockClient = apiClient as { get: ReturnType<typeof vi.fn> };

describe("write-gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		invalidateWriteGateCache();
	});

	// ─── checkWriteGate ─────────────────────────────────────────

	describe("checkWriteGate", () => {
		it("fast path: emailVerifiedAt=0 returns blocked EMAIL_NOT_VERIFIED without API call", async () => {
			const result = await checkWriteGate(0);
			expect(result).toEqual({
				blocked: true,
				reason: "请先验证邮箱后再进行操作",
				code: "EMAIL_NOT_VERIFIED",
			});
			expect(mockClient.get).not.toHaveBeenCalled();
		});

		it("emailVerifiedAt=null falls through to API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(null);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission");
		});

		it("emailVerifiedAt=undefined falls through to API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(undefined);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission");
		});

		it("positive emailVerifiedAt falls through to API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(1700000000);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission");
		});

		it("API returns allowed: true → { blocked: false }", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(null);
			expect(result).toEqual({ blocked: false });
		});

		it("API returns allowed: false with reason and code → blocked", async () => {
			mockClient.get.mockResolvedValue({
				data: { allowed: false, reason: "注册时间不足7天", code: "MIN_REG_DAYS" },
			});
			const result = await checkWriteGate(null);
			expect(result).toEqual({
				blocked: true,
				reason: "注册时间不足7天",
				code: "MIN_REG_DAYS",
			});
		});

		it("API returns allowed: false without reason/code → uses defaults", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: false } });
			const result = await checkWriteGate(null);
			expect(result).toEqual({
				blocked: true,
				reason: "您暂时无法操作",
				code: "POSTING_RESTRICTION",
			});
		});

		it("ApiError → blocked with error message", async () => {
			mockClient.get.mockRejectedValue(new ApiError("请登录后操作", 401, "UNAUTHORIZED"));
			const result = await checkWriteGate(null);
			expect(result).toEqual({
				blocked: true,
				reason: "请登录后操作",
				code: "UNAUTHORIZED",
			});
		});

		it("network error → not blocked (fallthrough to server guard)", async () => {
			mockClient.get.mockRejectedValue(new TypeError("Failed to fetch"));
			const result = await checkWriteGate(null);
			expect(result).toEqual({ blocked: false });
		});

		// ─── Cache behavior ──────────────────────────────────────

		it("second call within TTL uses cached result (no extra API call)", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });

			await checkWriteGate(null);
			await checkWriteGate(null);

			expect(mockClient.get).toHaveBeenCalledTimes(1);
		});

		it("cached blocked result is reused", async () => {
			mockClient.get.mockResolvedValue({
				data: { allowed: false, reason: "需要头像", code: "REQUIRE_AVATAR" },
			});

			const first = await checkWriteGate(null);
			const second = await checkWriteGate(null);

			expect(first).toEqual(second);
			expect(mockClient.get).toHaveBeenCalledTimes(1);
		});

		it("invalidateWriteGateCache forces fresh API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null);

			invalidateWriteGateCache();
			mockClient.get.mockResolvedValue({
				data: { allowed: false, reason: "新规则", code: "NEW_RULE" },
			});
			const result = await checkWriteGate(null);

			expect(mockClient.get).toHaveBeenCalledTimes(2);
			expect(result).toEqual({ blocked: true, reason: "新规则", code: "NEW_RULE" });
		});

		it("fast path (emailVerifiedAt=0) bypasses cache entirely", async () => {
			// Fill cache with allowed result
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null);

			// Even with "allowed" in cache, emailVerifiedAt=0 should block
			const result = await checkWriteGate(0);
			expect(result.blocked).toBe(true);
			expect(result.blocked && result.code).toBe("EMAIL_NOT_VERIFIED");
		});

		it("ApiError result is NOT cached", async () => {
			mockClient.get.mockRejectedValueOnce(new ApiError("Auth failed", 401));
			await checkWriteGate(null);

			// Second call should hit API again
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(null);
			expect(mockClient.get).toHaveBeenCalledTimes(2);
			expect(result).toEqual({ blocked: false });
		});
	});

	// ─── writeGatePreflight ──────────────────────────────────────

	describe("writeGatePreflight", () => {
		it("returns false and does NOT dispatch event when allowed", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const spy = vi.spyOn(window, "dispatchEvent");

			const blocked = await writeGatePreflight(null);
			expect(blocked).toBe(false);
			expect(spy).not.toHaveBeenCalled();

			spy.mockRestore();
		});

		it("returns true and dispatches write-gate event when blocked", async () => {
			mockClient.get.mockResolvedValue({
				data: { allowed: false, reason: "测试限制", code: "TEST_CODE" },
			});
			const spy = vi.spyOn(window, "dispatchEvent");

			const blocked = await writeGatePreflight(null);
			expect(blocked).toBe(true);

			expect(spy).toHaveBeenCalledTimes(1);
			const event = spy.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe(WRITE_GATE_EVENT);
			expect(event.detail).toEqual({ reason: "测试限制", code: "TEST_CODE" });

			spy.mockRestore();
		});

		it("dispatches event for fast-path email block", async () => {
			const spy = vi.spyOn(window, "dispatchEvent");

			const blocked = await writeGatePreflight(0);
			expect(blocked).toBe(true);

			const event = spy.mock.calls[0][0] as CustomEvent;
			expect(event.detail.code).toBe("EMAIL_NOT_VERIFIED");

			spy.mockRestore();
		});
	});

	// ─── dispatchWriteGate ───────────────────────────────────────

	describe("dispatchWriteGate", () => {
		it("dispatches CustomEvent on window", () => {
			const spy = vi.spyOn(window, "dispatchEvent");
			const result = dispatchWriteGate({ reason: "test", code: "TEST" });
			expect(result).toBe(true);
			expect(spy).toHaveBeenCalledTimes(1);
			const event = spy.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe("ellie:write-blocked");
			expect(event.detail).toEqual({ reason: "test", code: "TEST" });
			spy.mockRestore();
		});
	});

	// ─── CTA mapping ────────────────────────────────────────────

	describe("codeToRedirect", () => {
		it("EMAIL_NOT_VERIFIED → /verify-email", () => {
			expect(codeToRedirect("EMAIL_NOT_VERIFIED")).toBe("/verify-email");
		});

		it("REQUIRE_AVATAR → /me", () => {
			expect(codeToRedirect("REQUIRE_AVATAR")).toBe("/me");
		});

		it("unknown code → undefined", () => {
			expect(codeToRedirect("SOME_UNKNOWN")).toBeUndefined();
		});
	});

	describe("codeToCtaLabel", () => {
		it("EMAIL_NOT_VERIFIED → 去验证邮箱", () => {
			expect(codeToCtaLabel("EMAIL_NOT_VERIFIED")).toBe("去验证邮箱");
		});

		it("REQUIRE_AVATAR → 去设置头像", () => {
			expect(codeToCtaLabel("REQUIRE_AVATAR")).toBe("去设置头像");
		});

		it("unknown code → undefined", () => {
			expect(codeToCtaLabel("SOME_UNKNOWN")).toBeUndefined();
		});
	});
});
