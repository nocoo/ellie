// Unit tests for the browser-side forum API facade.
//
// These mock `apiClient` directly so we can verify the facade only:
// argument shape, error funneling, parser composition. The underlying
// `fetch`/envelope behavior is covered separately in api-client tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import * as browserApi from "@/lib/forum-browser-api";

vi.mock("@/lib/api-client", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
	return {
		...actual,
		apiClient: {
			get: vi.fn(),
			getList: vi.fn(),
			post: vi.fn(),
			patch: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			getRaw: vi.fn(),
			upload: vi.fn(),
		},
	};
});

const { apiClient } = await import("@/lib/api-client");
const m = apiClient as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("checkUsernameAvailability", () => {
	it("calls apiClient.getRaw with the right path/params and forwards signal", async () => {
		m.getRaw.mockResolvedValue({ available: true });
		const ctrl = new AbortController();
		const result = await browserApi.checkUsernameAvailability("alice", { signal: ctrl.signal });
		expect(m.getRaw).toHaveBeenCalledWith(
			"/api/auth/check-username",
			{ username: "alice" },
			{ signal: ctrl.signal },
		);
		expect(result).toEqual({ available: true });
	});

	it("collapses any error to {available:false, reason:'error'}", async () => {
		m.getRaw.mockRejectedValue(new ApiError(500, "X", "boom"));
		const result = await browserApi.checkUsernameAvailability("bob");
		expect(result).toEqual({ available: false, reason: "error" });
	});
});

describe("requestEmailVerificationCode", () => {
	it("POSTs the request body and returns data", async () => {
		m.post.mockResolvedValue({
			data: { sent_to: "x@y.z", next_resend_allowed_at: 60 },
			meta: {},
		});
		const result = await browserApi.requestEmailVerificationCode("x@y.z");
		expect(m.post).toHaveBeenCalledWith("/api/v1/users/me/email/request-code", {
			email: "x@y.z",
		});
		expect(result).toEqual({ sent_to: "x@y.z", next_resend_allowed_at: 60 });
	});

	it("propagates ApiError so the caller can run describeWrappedError(err.rawBody, err.status)", async () => {
		const apiErr = new ApiError(400, "EMAIL_ALREADY_IN_USE", "x");
		apiErr.rawBody = { error: { code: "EMAIL_ALREADY_IN_USE", message: "x" } };
		m.post.mockRejectedValue(apiErr);
		await expect(browserApi.requestEmailVerificationCode("x@y.z")).rejects.toBe(apiErr);
	});
});

describe("verifyEmailCode", () => {
	it("POSTs email + code only (no extra fields)", async () => {
		m.post.mockResolvedValue({ data: undefined, meta: {} });
		await browserApi.verifyEmailCode("x@y.z", "654321");
		expect(m.post).toHaveBeenCalledWith("/api/v1/users/me/email/verify", {
			email: "x@y.z",
			code: "654321",
		});
	});

	it("propagates ApiError unchanged", async () => {
		const apiErr = new ApiError(400, "CODE_INVALID", "bad");
		m.post.mockRejectedValue(apiErr);
		await expect(browserApi.verifyEmailCode("x@y.z", "000000")).rejects.toBe(apiErr);
	});
});

describe("uploadAvatar", () => {
	function file() {
		return new File(["x"], "a.png", { type: "image/png" });
	}

	it("builds FormData with purpose=avatar and POSTs via apiClient.upload", async () => {
		m.upload.mockResolvedValue({
			data: { url: "/u/1.png", size: 100 },
			meta: { timestamp: 1, requestId: "r" },
		});
		const result = await browserApi.uploadAvatar(file());
		expect(m.upload).toHaveBeenCalledTimes(1);
		const [path, fd] = m.upload.mock.calls[0] as [string, FormData];
		expect(path).toBe("/api/v1/upload");
		expect(fd.get("purpose")).toBe("avatar");
		expect(fd.get("file")).toBeInstanceOf(File);
		expect(result).toEqual({ kind: "success", url: "/u/1.png", size: 100 });
	});

	it("maps an ApiError(rawBody=§5.4) outcome through the parser to email-not-verified", async () => {
		const apiErr = new ApiError(403, "EMAIL_NOT_VERIFIED", "x");
		apiErr.rawBody = {
			error: "EMAIL_NOT_VERIFIED",
			message: "Verify first",
			dialog: { title: "T", body: "B", cta_label: "OK" },
			redirect_to: "/verify",
		};
		m.upload.mockRejectedValue(apiErr);
		const result = await browserApi.uploadAvatar(file());
		expect(result.kind).toBe("email-not-verified");
	});

	it("maps a wrapped-error outcome through the parser to error", async () => {
		const apiErr = new ApiError(413, "TOO_LARGE", "Too large");
		apiErr.rawBody = { error: { code: "TOO_LARGE", message: "服务器拒绝了该文件" } };
		m.upload.mockRejectedValue(apiErr);
		const result = await browserApi.uploadAvatar(file());
		expect(result).toEqual({ kind: "error", message: "服务器拒绝了该文件" });
	});

	it("re-throws non-ApiError (network failures) so the caller's catch branch fires", async () => {
		const err = new TypeError("Failed to fetch");
		m.upload.mockRejectedValue(err);
		await expect(browserApi.uploadAvatar(file())).rejects.toBe(err);
	});
});

describe("uploadPostImage", () => {
	function file() {
		return new File(["x"], "p.png", { type: "image/png" });
	}

	it("builds FormData with purpose=post-image and parses success", async () => {
		m.upload.mockResolvedValue({
			data: { url: "/p/1.png", size: 100, contentType: "image/png" },
			meta: { timestamp: 1, requestId: "r" },
		});
		const result = await browserApi.uploadPostImage(file());
		const [, fd] = m.upload.mock.calls[0] as [string, FormData];
		expect(fd.get("purpose")).toBe("post-image");
		expect(result).toEqual({
			kind: "success",
			url: "/p/1.png",
			size: 100,
			contentType: "image/png",
		});
	});
	it("re-throws non-ApiError so the editor's catch branch fires", async () => {
		const err = new TypeError("Failed to fetch");
		m.upload.mockRejectedValue(err);
		await expect(browserApi.uploadPostImage(file())).rejects.toBe(err);
	});
});

describe("fetchFeatureFlags", () => {
	it("calls apiClient.getRaw with the features. prefix and forwards signal", async () => {
		m.getRaw.mockResolvedValue({ "features.x": "true" });
		const ctrl = new AbortController();
		const result = await browserApi.fetchFeatureFlags({ signal: ctrl.signal });
		expect(m.getRaw).toHaveBeenCalledWith(
			"/api/v1/settings",
			{ prefix: "features." },
			{ signal: ctrl.signal },
		);
		expect(result).toEqual({ "features.x": "true" });
	});
});
