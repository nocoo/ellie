import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForumApiError, forumApi, publicUserToUser } from "../../../apps/web/src/lib/forum-api";
import { UserStatus } from "../../../packages/types/src/types";

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
});

// ---------------------------------------------------------------------------
// Environment variable validation
// ---------------------------------------------------------------------------

describe("forumApi environment validation", () => {
	it("throws when WORKER_API_URL is not set", async () => {
		process.env.WORKER_API_URL = undefined;

		try {
			await forumApi.get("/api/v1/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("WORKER_API_URL");
		}
	});

	it("throws when FORUM_API_KEY is not set", async () => {
		process.env.FORUM_API_KEY = undefined;

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
		};

		const user = publicUserToUser(publicUser);

		// Spread fields preserved
		expect(user.id).toBe(42);
		expect(user.username).toBe("testuser");
		expect(user.avatar).toBe("/avatar.png");
		expect(user.role).toBe(0);
		expect(user.regDate).toBe(1700000000);

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
		};

		const user = publicUserToUser(publicUser);

		expect(user.username).toBe("admin");
		expect(user.groupTitle).toBe("Admin");
		expect(user.customTitle).toBe("Administrator");
	});
});
