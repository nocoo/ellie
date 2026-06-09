import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@auth/core/jwt", () => ({ getToken: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/forum-api", () => ({
	forumApi: { get: vi.fn(), postAuth: vi.fn(), patchAuth: vi.fn(), post: vi.fn() },
	ForumApiError: class ForumApiError extends Error {
		code: string;
		status: number;
		rawBody?: unknown;
		constructor(msg: string, code: string, status = 500) {
			super(msg);
			this.code = code;
			this.status = status;
		}
	},
}));

import { getToken } from "@auth/core/jwt";
import { headers } from "next/headers";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { authPatch, getCurrentForumUser, getSessionProvider, getWorkerJwt } from "@/lib/forum-auth";

const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockHeaders = headers as ReturnType<typeof vi.fn>;
const mockPatchAuth = forumApi.patchAuth as ReturnType<typeof vi.fn>;
const mockPost = forumApi.post as ReturnType<typeof vi.fn>;

describe("forum-auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHeaders.mockResolvedValue(new Headers());
		process.env.AUTH_SECRET = "test-secret";
	});

	describe("getWorkerJwt", () => {
		it("returns null when no token", async () => {
			mockGetToken.mockResolvedValue(null);
			expect(await getWorkerJwt()).toBe(null);
		});

		it("returns null when provider is not credentials", async () => {
			mockGetToken.mockResolvedValue({ provider: "google", workerJwt: "jwt" });
			expect(await getWorkerJwt()).toBe(null);
		});

		it("returns null when token is expired", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", error: "RefreshTokenExpired" });
			expect(await getWorkerJwt()).toBe(null);
		});

		it("returns workerJwt when valid", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", workerJwt: "my-jwt" });
			expect(await getWorkerJwt()).toBe("my-jwt");
		});

		it("returns null when workerJwt is missing", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials" });
			expect(await getWorkerJwt()).toBe(null);
		});
	});

	describe("getCurrentForumUser", () => {
		it("returns null when no token", async () => {
			mockGetToken.mockResolvedValue(null);
			expect(await getCurrentForumUser()).toBe(null);
		});

		it("returns null when wrong provider", async () => {
			mockGetToken.mockResolvedValue({ provider: "github" });
			expect(await getCurrentForumUser()).toBe(null);
		});

		it("returns user info when valid", async () => {
			mockGetToken.mockResolvedValue({
				provider: "credentials",
				sub: "123",
				name: "Alice",
				role: 3,
			});
			expect(await getCurrentForumUser()).toEqual({ userId: 123, username: "Alice", role: 3 });
		});

		it("defaults name to empty and role to 0", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", sub: "1" });
			expect(await getCurrentForumUser()).toEqual({ userId: 1, username: "", role: 0 });
		});
	});

	describe("getSessionProvider", () => {
		it("returns null when no token", async () => {
			mockGetToken.mockResolvedValue(null);
			expect(await getSessionProvider()).toBe(null);
		});

		it("returns provider string", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials" });
			expect(await getSessionProvider()).toBe("credentials");
		});
	});

	describe("authPatch", () => {
		it("returns NOT_AUTHENTICATED when no token", async () => {
			mockGetToken.mockResolvedValue(null);
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});

		it("returns NOT_AUTHENTICATED when wrong provider", async () => {
			mockGetToken.mockResolvedValue({ provider: "google" });
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});

		it("returns NOT_AUTHENTICATED when RefreshTokenExpired", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", error: "RefreshTokenExpired" });
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});

		it("returns NOT_AUTHENTICATED when no workerJwt", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials" });
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});

		it("returns data on success", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", workerJwt: "jwt" });
			mockPatchAuth.mockResolvedValue({ data: { patched: true } });
			expect(await authPatch("/test", { y: 2 })).toEqual({ data: { patched: true } });
			expect(mockPatchAuth).toHaveBeenCalledWith("/test", { y: 2 }, "jwt", undefined);
		});

		it("re-throws non-TOKEN_EXPIRED ForumApiError so callers can preserve status/rawBody", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", workerJwt: "jwt" });
			const err = new ForumApiError("forbidden", "FORBIDDEN");
			mockPatchAuth.mockRejectedValue(err);
			await expect(authPatch("/test", {})).rejects.toBe(err);
		});

		it("re-throws non-ForumApiError errors (callers handle via try/catch)", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", workerJwt: "jwt" });
			const err = new Error("random");
			mockPatchAuth.mockRejectedValue(err);
			await expect(authPatch("/test", {})).rejects.toBe(err);
		});

		it("retries on TOKEN_EXPIRED with refresh", async () => {
			mockGetToken.mockResolvedValue({
				provider: "credentials",
				workerJwt: "jwt",
				workerRefreshToken: "rt",
			});
			mockPatchAuth.mockRejectedValueOnce(new ForumApiError("expired", "TOKEN_EXPIRED"));
			mockPost.mockResolvedValue({ data: { token: "new-jwt", refreshToken: "new-rt" } });
			mockPatchAuth.mockResolvedValueOnce({ data: { done: true } });
			expect(await authPatch("/test", {})).toEqual({ data: { done: true } });
		});

		it("returns NOT_AUTHENTICATED when no refreshToken on TOKEN_EXPIRED", async () => {
			mockGetToken.mockResolvedValue({ provider: "credentials", workerJwt: "jwt" });
			mockPatchAuth.mockRejectedValue(new ForumApiError("expired", "TOKEN_EXPIRED"));
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});

		it("returns NOT_AUTHENTICATED when refresh fails", async () => {
			mockGetToken.mockResolvedValue({
				provider: "credentials",
				workerJwt: "jwt",
				workerRefreshToken: "rt",
			});
			mockPatchAuth.mockRejectedValue(new ForumApiError("expired", "TOKEN_EXPIRED"));
			mockPost.mockRejectedValue(new Error("fail"));
			expect(await authPatch("/test", {})).toEqual({ error: "NOT_AUTHENTICATED" });
		});
	});
});
