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
	checkWriteGate,
	codeToCtaLabel,
	codeToRedirect,
	dispatchWriteGate,
	getWriteGateOnboardingSteps,
	invalidateWriteGateCache,
	setWriteGateScope,
	WRITE_GATE_EVENT,
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

		it("emailVerifiedAt=null falls through to API call with default action", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(null);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "message",
			});
		});

		it("emailVerifiedAt=undefined falls through to API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(undefined);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "message",
			});
		});

		it("positive emailVerifiedAt falls through to API call", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			const result = await checkWriteGate(1700000000);
			expect(result).toEqual({ blocked: false });
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "message",
			});
		});

		it("passes action='thread' to API", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "thread");
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "thread",
			});
		});

		it("passes action='reply' to API", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "reply");
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "reply",
			});
		});

		it("passes action='comment' to API", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "comment");
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "comment",
			});
		});

		it("passes action='report' to API", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "report");
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "report",
			});
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

		it("completed results do not restart the Worker snapshot deadline", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });

			await checkWriteGate(null, "thread");
			await checkWriteGate(null, "thread");

			expect(mockClient.get).toHaveBeenCalledTimes(2);
		});

		it("different actions have independent cache entries", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });

			await checkWriteGate(null, "thread");
			await checkWriteGate(null, "reply");

			expect(mockClient.get).toHaveBeenCalledTimes(2);
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "thread",
			});
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "reply",
			});
		});

		it("cached result for one action does not bleed into another", async () => {
			// "thread" blocked, "reply" allowed
			mockClient.get
				.mockResolvedValueOnce({
					data: { allowed: false, reason: "发帖暂停", code: "CONTENT_DISABLED" },
				})
				.mockResolvedValueOnce({ data: { allowed: true } });

			const threadResult = await checkWriteGate(null, "thread");
			const replyResult = await checkWriteGate(null, "reply");

			expect(threadResult).toEqual({
				blocked: true,
				reason: "发帖暂停",
				code: "CONTENT_DISABLED",
			});
			expect(replyResult).toEqual({ blocked: false });
		});

		it("invalidateWriteGateCache() clears all actions", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "thread");
			await checkWriteGate(null, "reply");

			invalidateWriteGateCache();
			mockClient.get.mockResolvedValue({
				data: { allowed: false, reason: "新规则", code: "NEW_RULE" },
			});

			const result = await checkWriteGate(null, "thread");
			expect(mockClient.get).toHaveBeenCalledTimes(3);
			expect(result).toEqual({ blocked: true, reason: "新规则", code: "NEW_RULE" });
		});

		it("shares only overlapping requests and isolates actions", async () => {
			let finish!: (value: unknown) => void;
			mockClient.get.mockImplementation(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			);
			const first = checkWriteGate(null, "thread");
			const second = checkWriteGate(null, "thread");
			expect(mockClient.get).toHaveBeenCalledTimes(1);
			finish({ data: { allowed: true } });
			expect(await Promise.all([first, second])).toEqual([{ blocked: false }, { blocked: false }]);
			mockClient.get.mockResolvedValue({ data: { allowed: false, code: "CHANGED" } });
			expect(await checkWriteGate(null, "thread")).toMatchObject({
				blocked: true,
				code: "CHANGED",
			});
			expect(mockClient.get).toHaveBeenCalledTimes(2);
		});

		it("invalidating one action fences its old request while another can finish", async () => {
			const finish = new Map<string, (value: unknown) => void>();
			mockClient.get.mockImplementation(
				(_url, { action }) =>
					new Promise((resolve) => {
						finish.set(action, resolve);
					}),
			);
			const thread = checkWriteGate(null, "thread");
			const reply = checkWriteGate(null, "reply");
			invalidateWriteGateCache("thread");
			(finish.get("thread") ?? expect.fail("Thread request did not start"))({
				data: { allowed: true },
			});
			(finish.get("reply") ?? expect.fail("Reply request did not start"))({
				data: { allowed: true },
			});
			expect(await thread).toMatchObject({ blocked: true, code: "SESSION_CHANGED" });
			expect(await reply).toEqual({ blocked: false });
		});

		it("does not produce SESSION_CHANGED when checkWriteGate starts before session resolution and same user resolves", async () => {
			// Reset module to guarantee fresh settledScope = false and currentScope = "unresolved"
			vi.resetModules();
			const freshModule = await import("@/viewmodels/forum/write-gate");
			const { apiClient: client } = await import("@/lib/api-client");
			const freshClient = client as unknown as { get: ReturnType<typeof vi.fn> };

			let finishFirst!: (value: unknown) => void;
			let finishRetry!: (value: unknown) => void;

			freshClient.get
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							finishFirst = resolve;
						}),
				)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							finishRetry = resolve;
						}),
				);

			// checkWriteGate starts early while scope is still initial/unresolved
			const checkPromise = freshModule.checkWriteGate(null, "thread");
			expect(freshClient.get).toHaveBeenCalledTimes(1);

			// Session resolves to user 10
			freshModule.setWriteGateScope("credentials:10:0:ok");

			// Old in-flight allowed response arrives
			finishFirst({ data: { allowed: true } });

			// Wait for microtask tick so task.promise executes the retry checkWriteGate
			await Promise.resolve();

			// A fresh retry must be triggered under the newly settled scope
			expect(freshClient.get).toHaveBeenCalledTimes(2);

			// Second API call returns denied; proves fresh retry overrides old allowed result
			finishRetry({
				data: { allowed: false, reason: "封禁中", code: "USER_BANNED" },
			});

			const result = await checkPromise;
			expect(result).toEqual({
				blocked: true,
				reason: "封禁中",
				code: "USER_BANNED",
			});
		});

		it("handles late failure during initial resolution by retrying under newly settled scope", async () => {
			vi.resetModules();
			const freshModule = await import("@/viewmodels/forum/write-gate");
			const { apiClient: client } = await import("@/lib/api-client");
			const freshClient = client as unknown as { get: ReturnType<typeof vi.fn> };

			let finishFirst!: (value: unknown) => void;
			let finishRetry!: (value: unknown) => void;

			freshClient.get
				.mockImplementationOnce(
					() =>
						new Promise((_resolve, reject) => {
							finishFirst = reject;
						}),
				)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							finishRetry = resolve;
						}),
				);

			// Starts under unresolved initial scope
			const checkPromise = freshModule.checkWriteGate(null, "thread");
			expect(freshClient.get).toHaveBeenCalledTimes(1);

			// Session resolves before network error returns
			freshModule.setWriteGateScope("credentials:10:0:ok");

			// Initial call rejects (late failure)
			finishFirst(new TypeError("Network error"));

			// Wait for microtask tick
			await Promise.resolve();

			// Retried under settled scope
			expect(freshClient.get).toHaveBeenCalledTimes(2);

			finishRetry({ data: { allowed: true } });
			const result = await checkPromise;
			expect(result).toEqual({ blocked: false });
		});

		it.each([false, true])(
			"account/role changes fence late success or failure (%s)",
			async (fail) => {
				setWriteGateScope("user:10:role:0");
				let finish!: (value: unknown) => void;
				mockClient.get.mockImplementation(
					() =>
						new Promise((resolve, reject) => {
							finish = fail ? reject : resolve;
						}),
				);
				const previous = checkWriteGate(null, "thread");
				setWriteGateScope("user:20:role:0");
				mockClient.get.mockResolvedValue({ data: { allowed: false, code: "NEW_USER" } });
				finish(fail ? new TypeError("Network failed") : { data: { allowed: true } });
				expect(await previous).toMatchObject({ blocked: true, code: "SESSION_CHANGED" });
				expect(await checkWriteGate(null, "thread")).toMatchObject({
					blocked: true,
					code: "NEW_USER",
				});
			},
		);

		it("fast path (emailVerifiedAt=0) bypasses cache entirely", async () => {
			// Fill cache with allowed result
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await checkWriteGate(null, "thread");

			// Even with "allowed" in cache, emailVerifiedAt=0 should block
			const result = await checkWriteGate(0, "thread");
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

		it("passes action parameter through to checkWriteGate", async () => {
			mockClient.get.mockResolvedValue({ data: { allowed: true } });
			await writeGatePreflight(null, "thread");
			expect(mockClient.get).toHaveBeenCalledWith("/api/v1/posting-permission", {
				action: "thread",
			});
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

		it("REQUIRE_AVATAR → /me#avatar", () => {
			expect(codeToRedirect("REQUIRE_AVATAR")).toBe("/me#avatar");
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

	// ─── Onboarding progress ────────────────────────────────────

	describe("getWriteGateOnboardingSteps", () => {
		it("EMAIL_NOT_VERIFIED → step 1 current, others pending", () => {
			expect(getWriteGateOnboardingSteps("EMAIL_NOT_VERIFIED")).toEqual([
				{ label: "验证邮箱", status: "current" },
				{ label: "设置头像", status: "pending" },
				{ label: "注册满一天", status: "pending" },
			]);
		});

		it("REQUIRE_AVATAR → step 1 done, step 2 current, step 3 pending", () => {
			expect(getWriteGateOnboardingSteps("REQUIRE_AVATAR")).toEqual([
				{ label: "验证邮箱", status: "done" },
				{ label: "设置头像", status: "current" },
				{ label: "注册满一天", status: "pending" },
			]);
		});

		it("MIN_REGISTRATION_DAYS → first two done, last current", () => {
			expect(getWriteGateOnboardingSteps("MIN_REGISTRATION_DAYS")).toEqual([
				{ label: "验证邮箱", status: "done" },
				{ label: "设置头像", status: "done" },
				{ label: "注册满一天", status: "current" },
			]);
		});

		it("unknown code → empty array (no progress shown)", () => {
			expect(getWriteGateOnboardingSteps("CONTENT_DISABLED")).toEqual([]);
			expect(getWriteGateOnboardingSteps("POSTING_RESTRICTION")).toEqual([]);
			expect(getWriteGateOnboardingSteps("")).toEqual([]);
		});
	});
});
