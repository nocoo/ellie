import { ForumApiError, forumApi, publicUserToUser } from "@/lib/forum-api";
import { UserStatus } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Setup: mock fetch + env vars
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

let mockFetchFn: ReturnType<typeof vi.fn>;

function mockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.FORUM_API_KEY = "test-forum-key";
	mockFetchFn = vi.fn(() =>
		Promise.resolve(mockResponse({ data: { ok: true }, meta: { timestamp: 1, requestId: "r1" } })),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.FORUM_API_KEY = originalEnv.FORUM_API_KEY;
});

// ---------------------------------------------------------------------------
// ForumApiError
// ---------------------------------------------------------------------------

describe("ForumApiError", () => {
	it("constructs with structured data (ApiErrorData)", () => {
		const err = new ForumApiError(404, { code: "NOT_FOUND", message: "User not found" });
		expect(err).toBeInstanceOf(ForumApiError);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("ForumApiError");
		expect(err.status).toBe(404);
		expect(err.code).toBe("NOT_FOUND");
		expect(err.message).toBe("User not found");
	});

	it("constructs with flat string args", () => {
		const err = new ForumApiError(500, "INTERNAL", "Server error");
		expect(err).toBeInstanceOf(ForumApiError);
		expect(err.status).toBe(500);
		expect(err.code).toBe("INTERNAL");
		expect(err.message).toBe("Server error");
	});

	it("constructs with structured data including details", () => {
		const err = new ForumApiError(400, {
			code: "VALIDATION",
			message: "Bad request",
			details: { field: "email" },
		});
		expect(err.details).toEqual({ field: "email" });
	});
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("forumApi request construction", () => {
	it("sends GET with X-API-Key header", async () => {
		await forumApi.get("/api/v1/stats");

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/v1/stats");
		expect(opts.method).toBe("GET");
		expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("test-forum-key");
		expect(opts.body).toBeUndefined();
	});

	it("appends search params to URL", async () => {
		await forumApi.get("/api/v1/users", { page: 2, limit: 20, search: "test" });

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("page")).toBe("2");
		expect(parsed.searchParams.get("limit")).toBe("20");
		expect(parsed.searchParams.get("search")).toBe("test");
	});

	it("skips null/undefined/empty search params", async () => {
		await forumApi.get("/api/v1/users", {
			page: 1,
			search: undefined,
			filter: null,
			empty: "",
		});

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("page")).toBe("1");
		expect(parsed.searchParams.has("search")).toBe(false);
		expect(parsed.searchParams.has("filter")).toBe(false);
		expect(parsed.searchParams.has("empty")).toBe(false);
	});

	it("includes boolean search params", async () => {
		await forumApi.get("/api/v1/threads", { pinned: true });

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("pinned")).toBe("true");
	});

	it("strips trailing slashes from WORKER_API_URL", async () => {
		process.env.WORKER_API_URL = "https://worker.example.com///";
		await forumApi.get("/api/v1/stats");

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/v1/stats");
	});

	it("sets Content-Type header when body is provided", async () => {
		await forumApi.post("/api/v1/posts", { title: "Hello" });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		expect(opts.body).toBe(JSON.stringify({ title: "Hello" }));
	});

	it("does not set Content-Type header when no body", async () => {
		await forumApi.get("/api/v1/stats");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
	});

	it("sets Authorization header for postAuth", async () => {
		await forumApi.postAuth("/api/v1/posts", { content: "hi" }, "jwt-token-123");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token-123");
	});

	it("sets Authorization header for deleteAuth", async () => {
		await forumApi.deleteAuth("/api/v1/posts/1", { reason: "spam" }, "jwt-token-456");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token-456");
		expect(opts.method).toBe("DELETE");
		expect(opts.body).toBe(JSON.stringify({ reason: "spam" }));
	});

	it("uses cache: no-store", async () => {
		await forumApi.get("/api/v1/stats");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.cache).toBe("no-store");
	});

	it("uses next.revalidate when GetOptions.revalidate is provided", async () => {
		await forumApi.get("/api/v1/settings", { revalidate: 60 });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.cache).toBeUndefined();
		expect((opts as Record<string, unknown>).next).toEqual({ revalidate: 60 });
	});

	it("passes searchParams from GetOptions correctly", async () => {
		await forumApi.get("/api/v1/settings", { revalidate: 30, searchParams: { key: "test" } });

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("key")).toBe("test");
		expect((opts as Record<string, unknown>).next).toEqual({ revalidate: 30 });
	});

	it("treats plain object without revalidate key as searchParams", async () => {
		await forumApi.get("/api/v1/users", { page: 1, limit: 10 });

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("page")).toBe("1");
		expect(parsed.searchParams.get("limit")).toBe("10");
		expect(opts.cache).toBe("no-store");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — get()
// ---------------------------------------------------------------------------

describe("forumApi.get()", () => {
	it("parses { data, meta } envelope", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({ data: { count: 42 }, meta: { timestamp: 123, requestId: "abc" } }),
			),
		);

		const result = await forumApi.get<{ count: number }>("/api/v1/stats");
		expect(result.data).toEqual({ count: 42 });
		expect(result.meta.timestamp).toBe(123);
		expect(result.meta.requestId).toBe("abc");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — getAll()
// ---------------------------------------------------------------------------

describe("forumApi.getAll()", () => {
	it("parses list response", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: [{ id: 1 }, { id: 2 }],
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.getAll<{ id: number }>("/api/v1/tags");
		expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
		expect(result.meta.requestId).toBe("r1");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — getCursor()
// ---------------------------------------------------------------------------

describe("forumApi.getCursor()", () => {
	it("parses cursor-paginated response with nextCursor", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: [{ id: 1 }],
					meta: { timestamp: 1, requestId: "r1", nextCursor: "cursor123" },
				}),
			),
		);

		const result = await forumApi.getCursor<{ id: number }>("/api/v1/threads");
		expect(result.data).toEqual([{ id: 1 }]);
		expect(result.meta.nextCursor).toBe("cursor123");
	});

	it("parses cursor-paginated response with null nextCursor", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: [],
					meta: { timestamp: 1, requestId: "r1", nextCursor: null },
				}),
			),
		);

		const result = await forumApi.getCursor<{ id: number }>("/api/v1/threads");
		expect(result.data).toEqual([]);
		expect(result.meta.nextCursor).toBeNull();
	});

	it("defaults nextCursor to null when meta has no nextCursor", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: [],
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.getCursor<{ id: number }>("/api/v1/threads");
		expect(result.meta.nextCursor).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Response parsing — getPage()
// ---------------------------------------------------------------------------

describe("forumApi.getPage()", () => {
	it("parses page-paginated response", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: [{ id: 1 }, { id: 2 }],
					meta: { timestamp: 1, requestId: "r1", total: 50, page: 1, limit: 20, pages: 3 },
				}),
			),
		);

		const result = await forumApi.getPage<{ id: number }>("/api/v1/users");
		expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
		expect(result.meta.total).toBe(50);
		expect(result.meta.page).toBe(1);
		expect(result.meta.limit).toBe(20);
		expect(result.meta.pages).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Response parsing — post()
// ---------------------------------------------------------------------------

describe("forumApi.post()", () => {
	it("parses post response", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { id: 1, title: "New Post" },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.post<{ id: number; title: string }>("/api/v1/posts", {
			title: "New Post",
		});
		expect(result.data.id).toBe(1);
		expect(result.data.title).toBe("New Post");
	});

	it("sends POST without body", async () => {
		await forumApi.post("/api/v1/action");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		// When body is undefined, the request function still sends it as undefined
		// but should NOT set Content-Type
		expect((opts.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Response parsing — postAuth()
// ---------------------------------------------------------------------------

describe("forumApi.postAuth()", () => {
	it("sends POST with body and bearer token", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { success: true },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.postAuth("/api/v1/like", { postId: 1 }, "token-abc");
		expect(result.data).toEqual({ success: true });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.method).toBe("POST");
		expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
		expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — postWithIP()
// ---------------------------------------------------------------------------

describe("forumApi.postWithIP()", () => {
	it("sends POST with client IP header", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { token: "jwt" },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.postWithIP("/api/v1/auth/login", { user: "a" }, "1.2.3.4");
		expect(result.data).toEqual({ token: "jwt" });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["X-Ellie-Client-IP"]).toBe("1.2.3.4");
		expect(opts.method).toBe("POST");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — getWithIP()
// ---------------------------------------------------------------------------

describe("forumApi.getWithIP()", () => {
	it("sends GET with client IP header and search params", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { available: true },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.getWithIP(
			"/api/v1/auth/check-username",
			{ username: "bob" },
			"5.6.7.8",
		);
		expect(result.data).toEqual({ available: true });

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("username=bob");
		expect((opts.headers as Record<string, string>)["X-Ellie-Client-IP"]).toBe("5.6.7.8");
		expect(opts.method).toBe("GET");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — patchAuth()
// ---------------------------------------------------------------------------

describe("forumApi.patchAuth()", () => {
	it("sends PATCH with bearer token", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { updated: true },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.patchAuth("/api/v1/users/me", { name: "new" }, "jwt-123");
		expect(result.data).toEqual({ updated: true });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer jwt-123");
		expect(opts.method).toBe("PATCH");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — getAuth()
// ---------------------------------------------------------------------------

describe("forumApi.getAuth()", () => {
	it("sends GET with bearer token and optional search params", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { user: { id: 1 } },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.getAuth("/api/v1/auth/me", "jwt-abc", { detail: "full" });
		expect(result.data).toEqual({ user: { id: 1 } });

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("detail=full");
		expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
		expect(opts.method).toBe("GET");
	});
});

// ---------------------------------------------------------------------------
// Response parsing — deleteAuth()
// ---------------------------------------------------------------------------

describe("forumApi.deleteAuth()", () => {
	it("sends DELETE with body and bearer token", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockResponse({
					data: { deleted: true },
					meta: { timestamp: 1, requestId: "r1" },
				}),
			),
		);

		const result = await forumApi.deleteAuth("/api/v1/posts/1", {}, "token-xyz");
		expect(result.data).toEqual({ deleted: true });
	});
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("forumApi error handling", () => {
	it("throws ForumApiError on 4xx with error body", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Post not found" } }), {
					status: 404,
				}),
			),
		);

		try {
			await forumApi.get("/api/v1/posts/999");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ForumApiError);
			const err = e as ForumApiError;
			expect(err.status).toBe(404);
			expect(err.code).toBe("NOT_FOUND");
			expect(err.message).toBe("Post not found");
		}
	});

	it("throws ForumApiError on 5xx without error body", async () => {
		mockFetchFn.mockImplementation(() => Promise.resolve(new Response("", { status: 500 })));

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ForumApiError);
			const err = e as ForumApiError;
			expect(err.status).toBe(500);
			expect(err.code).toBe("UNKNOWN");
		}
	});

	it("throws ForumApiError when response is not valid JSON", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(new Response("not json at all", { status: 200 })),
		);

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ForumApiError);
			const err = e as ForumApiError;
			expect(err.code).toBe("PARSE_ERROR");
			expect(err.message).toContain("Failed to parse Worker response");
			expect(err.message).toContain("not json at all".slice(0, 200));
		}
	});

	it("handles error response with structured error data including details", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: {
							code: "INVALID_BODY",
							message: "Bad request",
							details: { field: "title" },
						},
					}),
					{ status: 400 },
				),
			),
		);

		try {
			await forumApi.post("/api/v1/posts", { title: "" });
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as ForumApiError;
			expect(err.details).toEqual({ field: "title" });
		}
	});

	it("handles non-ok response with empty body (falls back to {})", async () => {
		mockFetchFn.mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ForumApiError);
			const err = e as ForumApiError;
			expect(err.status).toBe(503);
			expect(err.code).toBe("UNKNOWN");
		}
	});

	it("captures rawBody on error so proxy callers can re-emit unusual payloads (docs/17 §5.4)", async () => {
		// docs/17 §5.4: flat EmailNotVerifiedPayload — top-level `error` is the
		// literal string "EMAIL_NOT_VERIFIED", NOT the wrapped { code, message }
		// shape. The throw must still satisfy the wrapped contract for callers
		// that only read `code`/`message`, but the raw flat body must be preserved
		// on `rawBody` so proxy-error.ts can forward it verbatim.
		const flat = {
			error: "EMAIL_NOT_VERIFIED",
			message: "请先验证邮箱后再发布或回复内容。",
			dialog: { title: "需要验证邮箱", body: "x", cta_label: "去验证邮箱", cta_variant: "primary" },
			redirect_to: "/me#email",
		};
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify(flat), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		try {
			await forumApi.post("/api/v1/threads", { x: 1 });
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ForumApiError);
			const err = e as ForumApiError;
			expect(err.status).toBe(403);
			// Wrapped contract still satisfied for legacy callers.
			expect(err.code).toBe("EMAIL_NOT_VERIFIED");
			expect(err.message).toBe("请先验证邮箱后再发布或回复内容。");
			// Raw body preserved verbatim — same object as the wire shape.
			expect(err.rawBody).toEqual(flat);
		}
	});
});

// ---------------------------------------------------------------------------
// Environment variable validation
// ---------------------------------------------------------------------------

describe("forumApi environment validation", () => {
	it("throws when WORKER_API_URL is not set", async () => {
		process.env.WORKER_API_URL = "";

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("WORKER_API_URL");
		}
	});

	it("throws when FORUM_API_KEY is not set", async () => {
		process.env.FORUM_API_KEY = "";

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("FORUM_API_KEY");
		}
	});
});

// ---------------------------------------------------------------------------
// publicUserToUser type mapper
// ---------------------------------------------------------------------------

describe("publicUserToUser", () => {
	it("maps PublicUser to User with safe defaults", () => {
		const publicUser = {
			id: 42,
			username: "testuser",
			avatar: "/avatar.png",
			role: 0,
			regDate: 1700000000,
			threads: 10,
			posts: 50,
			credits: 100,
			signature: "Hello",
			groupTitle: "Member",
			groupStars: 1,
			groupColor: "#000",
			customTitle: "",
			digestPosts: 2,
			olTime: 3600,
			lastActivity: 1700001000,
			gender: 1,
			birthYear: 1990,
			birthMonth: 6,
			birthDay: 15,
			resideProvince: "Beijing",
			resideCity: "Beijing",
			graduateSchool: "PKU",
			bio: "A test user",
			interest: "coding",
			qq: "123456",
			site: "https://example.com",
			campus: "四平路校区",
			avatarPath: "",
			checkin: {
				totalDays: 365,
				monthDays: 28,
				streakDays: 90,
				lastCheckinAt: 1700001000,
				level: { minDays: 365, level: 9, label: "以坛为家II" } as const,
			},
		};

		const user = publicUserToUser(publicUser);

		// Spread fields preserved
		expect(user.id).toBe(42);
		expect(user.username).toBe("testuser");
		expect(user.avatar).toBe("/avatar.png");
		expect(user.role).toBe(0);
		expect(user.regDate).toBe(1700000000);
		expect(user.campus).toBe("四平路校区");
		expect(user.checkin?.totalDays).toBe(365);
		expect(user.checkin?.level?.label).toBe("以坛为家II");

		// User-only fields filled with safe defaults
		expect(user.email).toBe("");
		expect(user.status).toBe(UserStatus.Active);
		expect(user.lastLogin).toBe(0);
	});

	it("preserves all PublicUser fields through spread", () => {
		const publicUser = {
			id: 1,
			username: "admin",
			avatar: "/admin.png",
			role: 1,
			regDate: 0,
			threads: 0,
			posts: 0,
			credits: 0,
			signature: "",
			groupTitle: "Admin",
			groupStars: 3,
			groupColor: "#f00",
			customTitle: "Administrator",
			digestPosts: 0,
			olTime: 0,
			lastActivity: 0,
			gender: 0,
			birthYear: 0,
			birthMonth: 0,
			birthDay: 0,
			resideProvince: "",
			resideCity: "",
			graduateSchool: "",
			bio: "",
			interest: "",
			qq: "",
			site: "",
			campus: "",
			avatarPath: "",
			checkin: null,
		};

		const user = publicUserToUser(publicUser);

		expect(user.username).toBe("admin");
		expect(user.groupTitle).toBe("Admin");
		expect(user.customTitle).toBe("Administrator");
		expect(user.campus).toBe("");
		expect(user.checkin).toBeNull();
	});
});
