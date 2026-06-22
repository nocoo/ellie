import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CFRequest, Env } from "../../src/lib/env";

/**
 * Router-level tests for src/index.ts.
 * Covers infrastructure logic: CORS preflight, API key gate, maintenance gate,
 * tryTrackAuth, upload auth branch, 404 fallback, error handler, and scheduled.
 */

// Mock all handler dynamic imports to isolate router logic
const mockHandler = () => vi.fn(async () => new Response("ok", { status: 200 }));

vi.mock("../../src/handlers/live", () => ({
	live: mockHandler(),
}));
vi.mock("../../src/handlers/forum", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	getAncestors: mockHandler(),
	getThreadTypes: mockHandler(),
	setAnnouncement: mockHandler(),
}));
vi.mock("../../src/handlers/thread", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	create: mockHandler(),
}));
vi.mock("../../src/handlers/thread-edit", () => ({
	editThreadSubject: mockHandler(),
}));
vi.mock("../../src/handlers/post", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	create: mockHandler(),
}));
vi.mock("../../src/handlers/stats", () => ({
	stats: mockHandler(),
}));
vi.mock("../../src/handlers/auth", () => ({
	login: mockHandler(),
	refresh: mockHandler(),
	logout: mockHandler(),
	me: mockHandler(),
	register: mockHandler(),
	checkUsername: mockHandler(),
}));
vi.mock("../../src/handlers/me", () => ({
	updateProfile: mockHandler(),
	changePassword: mockHandler(),
}));
vi.mock("../../src/handlers/message", () => ({
	list: mockHandler(),
	unreadCount: mockHandler(),
	markAllRead: mockHandler(),
	getById: mockHandler(),
	create: mockHandler(),
	remove: mockHandler(),
}));
vi.mock("../../src/handlers/post-comment", () => ({
	list: mockHandler(),
	create: mockHandler(),
	batchByPostIds: mockHandler(),
}));
vi.mock("../../src/handlers/report", () => ({
	create: mockHandler(),
	checkPermission: mockHandler(),
}));
vi.mock("../../src/handlers/moderation", () => ({
	setSticky: mockHandler(),
	setDigest: mockHandler(),
	setClose: mockHandler(),
	moveThread: mockHandler(),
	setHighlight: mockHandler(),
	deleteThread: mockHandler(),
	deletePost: mockHandler(),
	editPost: mockHandler(),
	getUserStatus: mockHandler(),
	getUserIpRecords: mockHandler(),
	muteUser: mockHandler(),
	unmuteUser: mockHandler(),
	banUser: mockHandler(),
	unbanUser: mockHandler(),
	nukeUser: mockHandler(),
}));
// `recommended` handlers MUST mount BEFORE the bare DELETE
// /api/v1/moderation/threads/:id route (see src/index.ts:374-390).
// Pin both mocks here so dispatch + order asserts can inspect them
// without crossing module boundaries.
vi.mock("../../src/handlers/recommended", () => ({
	addRecommend: mockHandler(),
	removeRecommend: mockHandler(),
	listRecommendedThreads: mockHandler(),
}));
vi.mock("../../src/handlers/user-content", () => ({
	deleteMyPost: mockHandler(),
	deleteMyThread: mockHandler(),
	editMyPost: mockHandler(),
}));
vi.mock("../../src/handlers/user", () => ({
	getById: mockHandler(),
	getAvatarPath: mockHandler(),
	listThreads: mockHandler(),
	listPosts: mockHandler(),
	listDigest: mockHandler(),
	search: mockHandler(),
}));
vi.mock("../../src/handlers/search", () => ({
	searchThreads: mockHandler(),
}));
vi.mock("../../src/handlers/digest", () => ({
	list: mockHandler(),
	stats: mockHandler(),
	filters: mockHandler(),
}));
vi.mock("../../src/handlers/settings", () => ({
	list: mockHandler(),
}));
vi.mock("../../src/handlers/attachment", () => ({
	listByPost: mockHandler(),
}));
vi.mock("../../src/handlers/admin/forum", () => ({
	list: mockHandler(),
	create: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	reorder: mockHandler(),
	merge: mockHandler(),
}));
vi.mock("../../src/handlers/admin/thread", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
	batchMove: mockHandler(),
}));
vi.mock("../../src/handlers/admin/post", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
}));
vi.mock("../../src/handlers/admin/user", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	ban: mockHandler(),
	nuke: mockHandler(),
	batchFetch: mockHandler(),
	batchStatus: mockHandler(),
	batchRole: mockHandler(),
	batchRecalcCounters: mockHandler(),
	listStaff: mockHandler(),
	recalcCounters: mockHandler(),
}));
vi.mock("../../src/handlers/admin/statistics", () => ({
	recalcForums: mockHandler(),
	recalcThreads: mockHandler(),
	recalcUsers: mockHandler(),
}));
vi.mock("../../src/handlers/admin/attachment", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
}));
vi.mock("../../src/handlers/admin/ipBan", () => ({
	list: mockHandler(),
	create: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
	checkIp: mockHandler(),
}));
vi.mock("../../src/handlers/admin/censorWord", () => ({
	list: mockHandler(),
	create: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
	test: mockHandler(),
}));
vi.mock("../../src/handlers/admin/stats", () => ({
	handleStats: mockHandler(),
}));
vi.mock("../../src/handlers/admin/settings", () => ({
	list: mockHandler(),
	bulkUpdate: mockHandler(),
}));
vi.mock("../../src/handlers/admin/report", () => ({
	list: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	batchDelete: mockHandler(),
}));
vi.mock("../../src/handlers/admin/adminLog", () => ({
	list: mockHandler(),
	getById: mockHandler(),
}));
vi.mock("../../src/handlers/admin/announcement", () => ({
	list: mockHandler(),
	create: mockHandler(),
	getById: mockHandler(),
	update: mockHandler(),
	remove: mockHandler(),
	batchDelete: mockHandler(),
}));
vi.mock("../../src/lib/online-stats", () => ({
	aggregateOnlineStats: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/stats-rollover", () => ({
	checkAndRolloverDailyStats: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/analytics/loginHistory", () => ({
	cleanupLoginHistory: vi.fn(async () => 0),
	scheduleLoginHistory: vi.fn(),
}));
// P5 wiring — the worker boot binds the D1 flush sink at module load
// and the 19:00-UTC cron co-fires the analytics-daily-targets cleanup
// alongside the login-history cleanup. The tests must not exercise D1.
vi.mock("../../src/lib/analytics/collect", () => ({
	setFlushSink: vi.fn(),
	resetFlushSink: vi.fn(),
}));
vi.mock("../../src/lib/analytics/flushSink-d1", () => ({
	d1FlushSink: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/analytics/cleanup", () => ({
	cleanupAnalyticsDailyTargets: vi.fn(async () => 0),
	DEFAULT_RETENTION_HOURS: 48,
}));
// P5 internal ingest + admin today/visits handlers — keep router-only
// scope; do not invoke the real handlers.
vi.mock("../../src/handlers/internal/analyticsIngest", () => ({
	analyticsIngestHandler: mockHandler(),
}));
vi.mock("../../src/handlers/admin/todayVisits", () => ({
	getTodayVisitsKpi: mockHandler(),
	getTodayVisitsList: mockHandler(),
}));

// Mock maintenance middleware — default to disabled
const checkMaintenanceMock = vi.fn(async () => null);
vi.mock("../../src/middleware/maintenance", () => ({
	checkMaintenance: (...args: unknown[]) => checkMaintenanceMock(...args),
}));

// Mock auth middleware for tryTrackAuth and upload route
const authMiddlewareMock = vi.fn(async () => new Response(null, { status: 401 }));
const authMiddlewareVerifiedMock = vi.fn(async () => new Response(null, { status: 401 }));
const requireVerifiedEmailMock = vi.fn(async () => new Response(null, { status: 401 }));
vi.mock("../../src/middleware/auth", () => ({
	authMiddleware: (...args: unknown[]) => authMiddlewareMock(...args),
	authMiddlewareVerified: (...args: unknown[]) => authMiddlewareVerifiedMock(...args),
	requireVerifiedEmail: (...args: unknown[]) => requireVerifiedEmailMock(...args),
	optionalAuthVerified: vi.fn(async () => null),
}));

// Mock online tracking
const trackOnlineMock = vi.fn();
vi.mock("../../src/middleware/online", () => ({
	trackOnline: (...args: unknown[]) => trackOnlineMock(...args),
}));

const trackActivityMock = vi.fn();
vi.mock("../../src/middleware/activity", () => ({
	trackActivity: (...args: unknown[]) => trackActivityMock(...args),
}));

// Mock upload handler
const handleUploadMock = vi.fn(async () => new Response("{}", { status: 200 }));
vi.mock("../../src/lib/upload", () => ({
	handleUpload: (...args: unknown[]) => handleUploadMock(...args),
}));

// Mock post-image GET handler
const handleGetPostImageMock = vi.fn(async () => new Response("img", { status: 200 }));
vi.mock("../../src/lib/postImage", () => ({
	handleGetPostImage: (...args: unknown[]) => handleGetPostImageMock(...args),
}));

// Import the worker after all mocks are set up
import worker from "../../src/index";

// Helper: dynamically import a mocked handler module and return a specific function mock.
// Maps module keys used in test tables to their actual import paths.
const MODULE_PATHS: Record<string, string> = {
	forum: "../../src/handlers/forum",
	thread: "../../src/handlers/thread",
	"thread-edit": "../../src/handlers/thread-edit",
	post: "../../src/handlers/post",
	attachment: "../../src/handlers/attachment",
	user: "../../src/handlers/user",
	search: "../../src/handlers/search",
	digest: "../../src/handlers/digest",
	stats: "../../src/handlers/stats",
	settings: "../../src/handlers/settings",
	auth: "../../src/handlers/auth",
	me: "../../src/handlers/me",
	message: "../../src/handlers/message",
	"post-comment": "../../src/handlers/post-comment",
	report: "../../src/handlers/report",
	moderation: "../../src/handlers/moderation",
	recommended: "../../src/handlers/recommended",
	"user-content": "../../src/handlers/user-content",
	"admin/forum": "../../src/handlers/admin/forum",
	"admin/thread": "../../src/handlers/admin/thread",
	"admin/post": "../../src/handlers/admin/post",
	"admin/user": "../../src/handlers/admin/user",
	"admin/statistics": "../../src/handlers/admin/statistics",
	"admin/attachment": "../../src/handlers/admin/attachment",
	"admin/ipBan": "../../src/handlers/admin/ipBan",
	"admin/censorWord": "../../src/handlers/admin/censorWord",
	"admin/stats": "../../src/handlers/admin/stats",
	"admin/settings": "../../src/handlers/admin/settings",
	"admin/report": "../../src/handlers/admin/report",
	"admin/adminLog": "../../src/handlers/admin/adminLog",
	"admin/announcement": "../../src/handlers/admin/announcement",
	"admin/todayVisits": "../../src/handlers/admin/todayVisits",
};

async function expectHandlerCalled(mod: string, fn: string): Promise<void> {
	const modulePath = MODULE_PATHS[mod];
	const m = await import(modulePath);
	expect(m[fn]).toHaveBeenCalledTimes(1);
}

const TEST_API_KEY = "test-api-key";
const TEST_ADMIN_API_KEY = "test-admin-key";

function makeEnv(overrides?: Partial<Env>): Env {
	return {
		API_KEY: TEST_API_KEY,
		ADMIN_API_KEY: TEST_ADMIN_API_KEY,
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
		...overrides,
	} as Env;
}

function makeCtx(): ExecutionContext {
	return {
		waitUntil: vi.fn(),
		passThroughOnException: vi.fn(),
	} as unknown as ExecutionContext;
}

function makeRequest(method: string, path: string, headers?: Record<string, string>): CFRequest {
	return new Request(`https://api.example.com${path}`, {
		method,
		headers: {
			"X-API-Key": TEST_API_KEY,
			...(headers ?? {}),
		},
	}) as CFRequest;
}

describe("router (src/index.ts)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		checkMaintenanceMock.mockResolvedValue(null);
		authMiddlewareMock.mockResolvedValue(new Response(null, { status: 401 }));
	});

	// ─── CORS Preflight ─────────────────────────────────────────────

	describe("CORS preflight", () => {
		it("should return 204 with CORS headers for OPTIONS", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/v1/forums", {
				method: "OPTIONS",
				headers: { Origin: "https://ellie.nocoo.cloud" },
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(204);
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});

		it("should skip API key validation for OPTIONS", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			// No X-API-Key header
			const request = new Request("https://api.example.com/api/v1/forums", {
				method: "OPTIONS",
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(204);
		});
	});

	// ─── API Key Gate ───────────────────────────────────────────────

	describe("API key gate", () => {
		it("should reject requests without API key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/v1/forums", {
				method: "GET",
				// No X-API-Key header
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
		});

		it("should reject requests with wrong API key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/v1/forums", {
				method: "GET",
				headers: { "X-API-Key": "wrong-key" },
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
		});

		it("should pass through with correct API key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(200);
		});
	});

	// ─── Maintenance Gate ───────────────────────────────────────────

	describe("maintenance gate", () => {
		it("should block when maintenance is active", async () => {
			checkMaintenanceMock.mockResolvedValue(
				new Response(JSON.stringify({ error: { code: "MAINTENANCE" } }), { status: 503 }),
			);
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(503);
		});

		it("should pass through when maintenance is disabled", async () => {
			checkMaintenanceMock.mockResolvedValue(null);
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(200);
		});
	});

	// ─── Health Check ───────────────────────────────────────────────

	describe("health check", () => {
		it("should respond without API key for /api/live", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/live", {
				method: "GET",
				// No API key needed for health check
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(200);
		});
	});

	// ─── tryTrackAuth ───────────────────────────────────────────────

	describe("tryTrackAuth", () => {
		it("should trigger activity tracking when auth succeeds", async () => {
			const user = { userId: 10, role: 0, exp: 999999999 };
			authMiddlewareMock.mockResolvedValue({ user });
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums", {
				Authorization: "Bearer valid-token",
			});

			await worker.fetch(request, env, ctx);

			// waitUntil was called with tryTrackAuth promise
			expect(ctx.waitUntil).toHaveBeenCalled();
			// Wait for the internal promise to resolve
			const waitUntilCalls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls;
			// Resolve the tryTrackAuth promise
			await Promise.all(waitUntilCalls.map((c) => c[0]));

			expect(trackOnlineMock).toHaveBeenCalled();
			expect(trackActivityMock).toHaveBeenCalled();
		});

		it("should not track when no auth header", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			await worker.fetch(request, env, ctx);

			// waitUntil is still called (for tryTrackAuth) but it should be a no-op
			const waitUntilCalls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls;
			await Promise.all(waitUntilCalls.map((c) => c[0]));

			expect(trackOnlineMock).not.toHaveBeenCalled();
			expect(trackActivityMock).not.toHaveBeenCalled();
		});

		it("should not track when auth fails", async () => {
			authMiddlewareMock.mockResolvedValue(new Response(null, { status: 401 }));
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums", {
				Authorization: "Bearer invalid-token",
			});

			await worker.fetch(request, env, ctx);

			const waitUntilCalls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls;
			await Promise.all(waitUntilCalls.map((c) => c[0]));

			expect(trackOnlineMock).not.toHaveBeenCalled();
		});
	});

	// ─── Upload Auth Branch ─────────────────────────────────────────

	describe("upload route", () => {
		it("should return 401 when auth fails for upload", async () => {
			requireVerifiedEmailMock.mockResolvedValue(new Response(null, { status: 401 }));
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("POST", "/api/v1/upload");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
			expect(handleUploadMock).not.toHaveBeenCalled();
		});

		it("should delegate to handleUpload when auth succeeds", async () => {
			requireVerifiedEmailMock.mockResolvedValue({ user: { userId: 42, role: 0 } });
			handleUploadMock.mockResolvedValue(new Response("{}", { status: 200 }));
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("POST", "/api/v1/upload");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(200);
			expect(handleUploadMock).toHaveBeenCalledWith(request, env, ctx, 42, undefined);
		});

		it("should propagate §5.4 EMAIL_NOT_VERIFIED payload from requireVerifiedEmail", async () => {
			// Regression: the upload route is wired to requireVerifiedEmail (Phase 5b
			// Commit C). When that middleware emits the §5.4 flat payload, the router
			// must return it verbatim without invoking handleUpload.
			const { EMAIL_NOT_VERIFIED_PAYLOAD } = await import("@ellie/types");
			requireVerifiedEmailMock.mockResolvedValue(
				new Response(JSON.stringify(EMAIL_NOT_VERIFIED_PAYLOAD), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				}),
			);
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("POST", "/api/v1/upload");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(403);
			expect(handleUploadMock).not.toHaveBeenCalled();
			const body = await response.json();
			expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
		});
	});

	// ─── Post-image GET route (Key A only) ──────────────────────────

	describe("post-image GET route", () => {
		it("should return 401 without X-API-Key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			// Build request without the API key header
			const request = new Request(
				"https://api.example.com/api/v1/post-images/550e8400-e29b-41d4-a716-446655440000.jpg",
				{ method: "GET" },
			) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
			expect(handleGetPostImageMock).not.toHaveBeenCalled();
		});

		it("should return 401 with wrong X-API-Key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request(
				"https://api.example.com/api/v1/post-images/550e8400-e29b-41d4-a716-446655440000.jpg",
				{ method: "GET", headers: { "X-API-Key": "wrong-key" } },
			) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
			expect(handleGetPostImageMock).not.toHaveBeenCalled();
		});

		it("should delegate to handleGetPostImage with path suffix when Key A presented", async () => {
			handleGetPostImageMock.mockResolvedValue(
				new Response("img", {
					status: 200,
					headers: { "Content-Type": "image/jpeg" },
				}),
			);
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest(
				"GET",
				"/api/v1/post-images/550e8400-e29b-41d4-a716-446655440000.jpg",
			);

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(200);
			expect(handleGetPostImageMock).toHaveBeenCalledTimes(1);
			expect(handleGetPostImageMock.mock.calls[0][0]).toBe(
				"550e8400-e29b-41d4-a716-446655440000.jpg",
			);
			expect(handleGetPostImageMock.mock.calls[0][1]).toBe(env);
		});

		it("should not match POST on /api/v1/post-images/...", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest(
				"POST",
				"/api/v1/post-images/550e8400-e29b-41d4-a716-446655440000.jpg",
			);

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(404);
			expect(handleGetPostImageMock).not.toHaveBeenCalled();
		});
	});

	// ─── 404 Fallback ───────────────────────────────────────────────

	describe("404 fallback", () => {
		it("should return 404 for unknown paths", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/nonexistent-route");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("NOT_FOUND");
		});

		it("should return 404 for wrong HTTP method on existing path", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("DELETE", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(404);
		});

		// ─── Fail-closed allowlist ──────────────────────────────────
		//
		// `validateApiKey` is an explicit allowlist: only `/api/v1/*` and
		// `/api/admin/*` are accepted. Any non-prefixed path is rejected
		// with 401 even when the caller presents a valid Key A — it must
		// NOT fall through to the 404 NOT_FOUND branch. This is the
		// CVE-2026-29045-style fail-closed default (see STU-1103).

		it("should return 401 (not 404) for non-prefixed path with valid Key A", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/foo/bar");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("UNAUTHORIZED");
		});

		it("should return 401 for /api (no version segment) with valid Key A", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
		});
	});

	// ─── Error Handler ──────────────────────────────────────────────

	describe("error handler", () => {
		it("should return 500 when handler throws", async () => {
			// Make the forum list handler throw
			const { list } = await import("../../src/handlers/forum");
			(list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB connection failed"));

			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(500);
			const data = await response.json();
			expect(data.error.code).toBe("INTERNAL_ERROR");
			expect(data.error.details.message).toBe("DB connection failed");
		});

		it("should handle non-Error thrown values", async () => {
			const { list } = await import("../../src/handlers/forum");
			(list as ReturnType<typeof vi.fn>).mockRejectedValueOnce("string error");

			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/v1/forums");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(500);
			const data = await response.json();
			expect(data.error.details.message).toBe("string error");
		});
	});

	// ─── Scheduled Handler ──────────────────────────────────────────

	describe("scheduled", () => {
		it("dispatches the */5 cron to aggregateOnlineStats + checkAndRolloverDailyStats via waitUntil", async () => {
			const onlineStats = await import("../../src/lib/online-stats");
			const loginHistory = await import("../../src/lib/analytics/loginHistory");
			const statsRollover = await import("../../src/lib/stats-rollover");
			(onlineStats.aggregateOnlineStats as ReturnType<typeof vi.fn>).mockClear();
			(loginHistory.cleanupLoginHistory as ReturnType<typeof vi.fn>).mockClear();
			(statsRollover.checkAndRolloverDailyStats as ReturnType<typeof vi.fn>).mockClear();
			const env = makeEnv();
			const ctx = makeCtx();
			const event = { cron: "*/5 * * * *" } as ScheduledEvent;

			await worker.scheduled(event, env, ctx);

			expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
			expect(onlineStats.aggregateOnlineStats).toHaveBeenCalledTimes(1);
			expect(statsRollover.checkAndRolloverDailyStats).toHaveBeenCalledTimes(1);
			expect(loginHistory.cleanupLoginHistory).not.toHaveBeenCalled();
		});

		it("dispatches the 03:00 Asia/Shanghai cron to cleanupLoginHistory + cleanupAnalyticsDailyTargets via waitUntil", async () => {
			const onlineStats = await import("../../src/lib/online-stats");
			const loginHistory = await import("../../src/lib/analytics/loginHistory");
			const analyticsCleanup = await import("../../src/lib/analytics/cleanup");
			(onlineStats.aggregateOnlineStats as ReturnType<typeof vi.fn>).mockClear();
			(loginHistory.cleanupLoginHistory as ReturnType<typeof vi.fn>).mockClear();
			(analyticsCleanup.cleanupAnalyticsDailyTargets as ReturnType<typeof vi.fn>).mockClear();
			const env = makeEnv();
			const ctx = makeCtx();
			const event = { cron: "0 19 * * *" } as ScheduledEvent;

			await worker.scheduled(event, env, ctx);

			// Both retention jobs are queued via waitUntil so a failure in
			// one does not block the other (P5 reviewer pin).
			expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
			expect(loginHistory.cleanupLoginHistory).toHaveBeenCalledTimes(1);
			expect(analyticsCleanup.cleanupAnalyticsDailyTargets).toHaveBeenCalledTimes(1);
			expect(onlineStats.aggregateOnlineStats).not.toHaveBeenCalled();
		});

		it("swallows cleanupAnalyticsDailyTargets rejection independently of cleanupLoginHistory", async () => {
			const loginHistory = await import("../../src/lib/analytics/loginHistory");
			const analyticsCleanup = await import("../../src/lib/analytics/cleanup");
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			(loginHistory.cleanupLoginHistory as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
			(
				analyticsCleanup.cleanupAnalyticsDailyTargets as ReturnType<typeof vi.fn>
			).mockImplementationOnce(async () => {
				throw new Error("D1 outage");
			});
			const tasks: Promise<unknown>[] = [];
			const ctx = {
				waitUntil: vi.fn((p: Promise<unknown>) => {
					tasks.push(p);
				}),
				passThroughOnException: vi.fn(),
			} as unknown as ExecutionContext;
			const env = makeEnv();
			const event = { cron: "0 19 * * *" } as ScheduledEvent;

			await worker.scheduled(event, env, ctx);
			await Promise.all(tasks);

			expect(warn).toHaveBeenCalledWith(
				"[cron] cleanupAnalyticsDailyTargets failed",
				expect.any(Error),
			);
			warn.mockRestore();
		});

		it("swallows cleanupLoginHistory rejection so cron does not bubble", async () => {
			const loginHistory = await import("../../src/lib/analytics/loginHistory");
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			(loginHistory.cleanupLoginHistory as ReturnType<typeof vi.fn>).mockImplementationOnce(
				async () => {
					throw new Error("D1 outage");
				},
			);
			const tasks: Promise<unknown>[] = [];
			const ctx = {
				waitUntil: vi.fn((p: Promise<unknown>) => {
					tasks.push(p);
				}),
				passThroughOnException: vi.fn(),
			} as unknown as ExecutionContext;
			const env = makeEnv();
			const event = { cron: "0 19 * * *" } as ScheduledEvent;

			await worker.scheduled(event, env, ctx);
			// Drain the waitUntil-queued promise so the inner catch runs.
			await Promise.all(tasks);

			expect(warn).toHaveBeenCalledWith("[cron] cleanupLoginHistory failed", expect.any(Error));
			warn.mockRestore();
		});

		it("logs a warning on an unknown cron schedule (drift safety net)", async () => {
			const onlineStats = await import("../../src/lib/online-stats");
			const loginHistory = await import("../../src/lib/analytics/loginHistory");
			(onlineStats.aggregateOnlineStats as ReturnType<typeof vi.fn>).mockClear();
			(loginHistory.cleanupLoginHistory as ReturnType<typeof vi.fn>).mockClear();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const env = makeEnv();
			const ctx = makeCtx();
			const event = { cron: "1 2 3 4 5" } as ScheduledEvent;

			await worker.scheduled(event, env, ctx);

			expect(ctx.waitUntil).not.toHaveBeenCalled();
			expect(onlineStats.aggregateOnlineStats).not.toHaveBeenCalled();
			expect(loginHistory.cleanupLoginHistory).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledWith(
				"[cron] unknown schedule fired",
				expect.objectContaining({ cron: "1 2 3 4 5" }),
			);
			warn.mockRestore();
		});
	});

	// ─── P5 Ingest Route Order ──────────────────────────────────────

	describe("P5 analytics ingest route order", () => {
		it("dispatches POST /api/internal/analytics/ingest WITHOUT a forum API key", async () => {
			// The web proxy reaches the ingest endpoint with only its
			// shared `X-Ingest-Key` secret — it never holds the forum
			// `X-API-Key`. The router MUST register this route AHEAD of
			// `validateApiKey` (reviewer pin).
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/internal/analytics/ingest", {
				method: "POST",
				// Intentionally NO X-API-Key header.
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			// The mocked handler returns 200; the real handler enforces
			// secret + body whitelist. Either way, the response is NOT
			// the 401 emitted by `validateApiKey`, which proves the
			// dispatch happened ahead of the Key-A gate.
			expect(response.status).not.toBe(401);
			const ingest = await import("../../src/handlers/internal/analyticsIngest");
			expect(ingest.analyticsIngestHandler).toHaveBeenCalledTimes(1);
		});

		it("returns 401 for non-POST on the ingest path (not handled by router)", async () => {
			// Only POST is wired. GET falls through to the API-key gate,
			// where `validateApiKey` rejects fail-closed because
			// `/api/internal/*` is not in the allowlist (Key A / Key B
			// allowlist covers `/api/v1/*` and `/api/admin/*` only). The
			// ingest handler MUST NOT be invoked.
			const env = makeEnv();
			const ctx = makeCtx();
			const request = makeRequest("GET", "/api/internal/analytics/ingest");

			const response = await worker.fetch(request, env, ctx);

			expect(response.status).toBe(401);
			const ingest = await import("../../src/handlers/internal/analyticsIngest");
			expect(ingest.analyticsIngestHandler).not.toHaveBeenCalled();
		});
	});

	// ─── Admin Route Key B Gate ─────────────────────────────────────

	describe("admin key B gate", () => {
		it("should reject admin routes with wrong admin key", async () => {
			const env = makeEnv();
			const ctx = makeCtx();
			const request = new Request("https://api.example.com/api/admin/forums", {
				method: "GET",
				headers: {
					"X-API-Key": TEST_API_KEY, // Key A, not Key B
				},
			}) as CFRequest;

			const response = await worker.fetch(request, env, ctx);

			// Admin routes require ADMIN_API_KEY (Key B); Key A routes to admin → either 401 or 404
			// depending on admin middleware. At minimum it should not be 200
			expect(response.status).not.toBe(200);
		});
	});

	// ─── Route Dispatch ─────────────────────────────────────────────

	describe("route dispatch", () => {
		function makeAdminRequest(method: string, path: string): CFRequest {
			return new Request(`https://api.example.com${path}`, {
				method,
				headers: { "X-API-Key": TEST_ADMIN_API_KEY },
			}) as CFRequest;
		}

		describe("public routes", () => {
			it.each([
				["GET", "/api/v1/forums", "forum", "list"],
				["GET", "/api/v1/forums/1", "forum", "getById"],
				["GET", "/api/v1/forums/1/ancestors", "forum", "getAncestors"],
				["GET", "/api/v1/forums/1/thread-types", "forum", "getThreadTypes"],
				["GET", "/api/v1/forums/1/recommended-threads", "recommended", "listRecommendedThreads"],
				["GET", "/api/v1/threads", "thread", "list"],
				["GET", "/api/v1/threads/1", "thread", "getById"],
				["GET", "/api/v1/posts", "post", "list"],
				["GET", "/api/v1/posts/1", "post", "getById"],
				["GET", "/api/v1/posts/1/attachments", "attachment", "listByPost"],
				["GET", "/api/v1/users/1", "user", "getById"],
				["GET", "/api/v1/users/1/avatar-path", "user", "getAvatarPath"],
				["GET", "/api/v1/users/1/threads", "user", "listThreads"],
				["GET", "/api/v1/users/1/posts", "user", "listPosts"],
				["GET", "/api/v1/users/1/digest", "user", "listDigest"],
				["GET", "/api/v1/users/search", "user", "search"],
				["GET", "/api/v1/search/threads", "search", "searchThreads"],
				["GET", "/api/v1/digest", "digest", "list"],
				["GET", "/api/v1/digest/stats", "digest", "stats"],
				["GET", "/api/v1/digest/filters", "digest", "filters"],
				["GET", "/api/v1/stats", "stats", "stats"],
				["GET", "/api/v1/settings", "settings", "list"],
			])("%s %s → %s.%s", async (method, path, mod, fn) => {
				const request = makeRequest(method, path);
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				await expectHandlerCalled(mod, fn);
			});
		});

		describe("auth routes", () => {
			it.each([
				["POST", "/api/v1/auth/login", "auth", "login"],
				["POST", "/api/v1/auth/refresh", "auth", "refresh"],
				["DELETE", "/api/v1/auth/logout", "auth", "logout"],
				["GET", "/api/v1/auth/me", "auth", "me"],
				["POST", "/api/v1/auth/register", "auth", "register"],
				["GET", "/api/v1/auth/check-username", "auth", "checkUsername"],
			])("%s %s → %s.%s", async (method, path, mod, fn) => {
				const request = makeRequest(method, path);
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				await expectHandlerCalled(mod, fn);
			});
		});

		describe("authenticated routes", () => {
			it.each([
				["POST", "/api/v1/threads", "thread", "create"],
				["POST", "/api/v1/posts", "post", "create"],
				["PATCH", "/api/v1/forums/1/announcement", "forum", "setAnnouncement"],
				["PATCH", "/api/v1/users/me", "me", "updateProfile"],
				["POST", "/api/v1/users/me/password", "me", "changePassword"],
				["GET", "/api/v1/messages", "message", "list"],
				["GET", "/api/v1/messages/unread-count", "message", "unreadCount"],
				["POST", "/api/v1/messages/mark-all-read", "message", "markAllRead"],
				["GET", "/api/v1/messages/1", "message", "getById"],
				["POST", "/api/v1/messages", "message", "create"],
				["DELETE", "/api/v1/messages/1", "message", "remove"],
				["GET", "/api/v1/post-comments", "post-comment", "list"],
				["POST", "/api/v1/post-comments", "post-comment", "create"],
				["POST", "/api/v1/post-comments/batch", "post-comment", "batchByPostIds"],
				["POST", "/api/v1/reports", "report", "create"],
				["GET", "/api/v1/posting-permission", "report", "checkPermission"],
				["DELETE", "/api/v1/me/posts/1", "user-content", "deleteMyPost"],
				["DELETE", "/api/v1/me/threads/1", "user-content", "deleteMyThread"],
				["PATCH", "/api/v1/me/posts/1", "user-content", "editMyPost"],
				["PATCH", "/api/v1/threads/1", "thread-edit", "editThreadSubject"],
			])("%s %s → %s.%s", async (method, path, mod, fn) => {
				const request = makeRequest(method, path);
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				await expectHandlerCalled(mod, fn);
			});
		});

		describe("moderation routes", () => {
			it.each([
				["PATCH", "/api/v1/moderation/threads/1/sticky", "moderation", "setSticky"],
				["PATCH", "/api/v1/moderation/threads/1/digest", "moderation", "setDigest"],
				["PATCH", "/api/v1/moderation/threads/1/close", "moderation", "setClose"],
				["PATCH", "/api/v1/moderation/threads/1/move", "moderation", "moveThread"],
				["PATCH", "/api/v1/moderation/threads/1/highlight", "moderation", "setHighlight"],
				["POST", "/api/v1/moderation/threads/1/recommend", "recommended", "addRecommend"],
				["DELETE", "/api/v1/moderation/threads/1/recommend", "recommended", "removeRecommend"],
				["DELETE", "/api/v1/moderation/threads/1", "moderation", "deleteThread"],
				["DELETE", "/api/v1/moderation/posts/1", "moderation", "deletePost"],
				["PATCH", "/api/v1/moderation/posts/1", "moderation", "editPost"],
				["GET", "/api/v1/moderation/users/1/status", "moderation", "getUserStatus"],
				["GET", "/api/v1/moderation/users/1/ip-records", "moderation", "getUserIpRecords"],
				["POST", "/api/v1/moderation/users/1/mute", "moderation", "muteUser"],
				["POST", "/api/v1/moderation/users/1/unmute", "moderation", "unmuteUser"],
				["POST", "/api/v1/moderation/users/1/ban", "moderation", "banUser"],
				["POST", "/api/v1/moderation/users/1/unban", "moderation", "unbanUser"],
				["POST", "/api/v1/moderation/users/1/nuke", "moderation", "nukeUser"],
			])("%s %s → %s.%s", async (method, path, mod, fn) => {
				const request = makeRequest(method, path);
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				await expectHandlerCalled(mod, fn);
			});
		});

		// ─── Recommend route order pin ─────────────────────────────────
		//
		// D0 v2 hard requirement (msg=a629d81c / Blocker 5): the new
		// `^/api/v1/moderation/threads/\d+/recommend$` routes MUST be
		// matched BEFORE the bare `^/api/v1/moderation/threads/\d+$`
		// DELETE route. Otherwise the regex
		// `^/api/v1/moderation/threads/\d+$` would never match
		// `/recommend` URLs — true, but the inverse trap is a future
		// refactor that loosens the bare path to a `^/api/v1/.../\d+`
		// prefix or drops the `$` anchor, silently routing
		// `DELETE /recommend` to `deleteThread` and nuking the thread
		// on what looked like an unrecommend click. This describe
		// block pins the actual handler dispatch so any such drift
		// fails loudly.
		describe("recommend route order (DELETE /recommend must not fall into deleteThread)", () => {
			it("POST /recommend → recommended.addRecommend, NOT moderation.deleteThread", async () => {
				const request = makeRequest("POST", "/api/v1/moderation/threads/123/recommend");
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				const recommended = await import("../../src/handlers/recommended");
				const moderation = await import("../../src/handlers/moderation");
				expect(recommended.addRecommend).toHaveBeenCalledTimes(1);
				expect(moderation.deleteThread).not.toHaveBeenCalled();
			});

			it("DELETE /recommend → recommended.removeRecommend, NOT moderation.deleteThread", async () => {
				const request = makeRequest("DELETE", "/api/v1/moderation/threads/123/recommend");
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				const recommended = await import("../../src/handlers/recommended");
				const moderation = await import("../../src/handlers/moderation");
				expect(recommended.removeRecommend).toHaveBeenCalledTimes(1);
				expect(moderation.deleteThread).not.toHaveBeenCalled();
			});

			it("bare DELETE /threads/:id (no /recommend suffix) still routes to deleteThread", async () => {
				// Negative control: confirms the order-pin above does not
				// accidentally swallow the legitimate delete-thread route.
				const request = makeRequest("DELETE", "/api/v1/moderation/threads/123");
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				const recommended = await import("../../src/handlers/recommended");
				const moderation = await import("../../src/handlers/moderation");
				expect(moderation.deleteThread).toHaveBeenCalledTimes(1);
				expect(recommended.removeRecommend).not.toHaveBeenCalled();
			});

			it("GET /api/v1/forums/:id/recommended-threads → recommended.listRecommendedThreads, NOT forum.getById", async () => {
				// The public read uses the suffix `/recommended-threads`
				// which lexically prefixes nothing else — but the bare
				// `^/api/v1/forums/\d+$` route would happily match the
				// `1` in `/forums/1/recommended-threads` if a future
				// regex regression drops the `$` anchor. Pin it.
				const request = makeRequest("GET", "/api/v1/forums/1/recommended-threads");
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				const recommended = await import("../../src/handlers/recommended");
				const forum = await import("../../src/handlers/forum");
				expect(recommended.listRecommendedThreads).toHaveBeenCalledTimes(1);
				expect(forum.getById).not.toHaveBeenCalled();
			});
		});

		describe("admin routes", () => {
			it.each([
				// Forums
				["GET", "/api/admin/forums", "admin/forum", "list"],
				["POST", "/api/admin/forums", "admin/forum", "create"],
				["GET", "/api/admin/forums/1", "admin/forum", "getById"],
				["PATCH", "/api/admin/forums/1", "admin/forum", "update"],
				["DELETE", "/api/admin/forums/1", "admin/forum", "remove"],
				["POST", "/api/admin/forums/reorder", "admin/forum", "reorder"],
				["POST", "/api/admin/forums/1/merge", "admin/forum", "merge"],
				// Threads
				["GET", "/api/admin/threads", "admin/thread", "list"],
				["GET", "/api/admin/threads/1", "admin/thread", "getById"],
				["PATCH", "/api/admin/threads/1", "admin/thread", "update"],
				["DELETE", "/api/admin/threads/1", "admin/thread", "remove"],
				["POST", "/api/admin/threads/batch-delete", "admin/thread", "batchDelete"],
				["POST", "/api/admin/threads/batch-move", "admin/thread", "batchMove"],
				// Posts
				["GET", "/api/admin/posts", "admin/post", "list"],
				["GET", "/api/admin/posts/1", "admin/post", "getById"],
				["PATCH", "/api/admin/posts/1", "admin/post", "update"],
				["DELETE", "/api/admin/posts/1", "admin/post", "remove"],
				["POST", "/api/admin/posts/batch-delete", "admin/post", "batchDelete"],
				// Users
				["GET", "/api/admin/users", "admin/user", "list"],
				["GET", "/api/admin/users/1", "admin/user", "getById"],
				["PATCH", "/api/admin/users/1", "admin/user", "update"],
				["POST", "/api/admin/users/1/ban", "admin/user", "ban"],
				["POST", "/api/admin/users/1/nuke", "admin/user", "nuke"],
				["POST", "/api/admin/users/1/recalc-counters", "admin/user", "recalcCounters"],
				["GET", "/api/admin/users/batch", "admin/user", "batchFetch"],
				["POST", "/api/admin/users/batch-status", "admin/user", "batchStatus"],
				["POST", "/api/admin/users/batch-role", "admin/user", "batchRole"],
				["POST", "/api/admin/users/batch-recalc-counters", "admin/user", "batchRecalcCounters"],
				["GET", "/api/admin/users/staff", "admin/user", "listStaff"],
				// Statistics
				["POST", "/api/admin/statistics/recalc-forums", "admin/statistics", "recalcForums"],
				["POST", "/api/admin/statistics/recalc-threads", "admin/statistics", "recalcThreads"],
				["POST", "/api/admin/statistics/recalc-users", "admin/statistics", "recalcUsers"],
				// Attachments
				["GET", "/api/admin/attachments", "admin/attachment", "list"],
				["GET", "/api/admin/attachments/1", "admin/attachment", "getById"],
				["DELETE", "/api/admin/attachments/1", "admin/attachment", "remove"],
				["POST", "/api/admin/attachments/batch-delete", "admin/attachment", "batchDelete"],
				// IP Bans
				["GET", "/api/admin/ip-bans", "admin/ipBan", "list"],
				["POST", "/api/admin/ip-bans", "admin/ipBan", "create"],
				["GET", "/api/admin/ip-bans/1", "admin/ipBan", "getById"],
				["PATCH", "/api/admin/ip-bans/1", "admin/ipBan", "update"],
				["DELETE", "/api/admin/ip-bans/1", "admin/ipBan", "remove"],
				["POST", "/api/admin/ip-bans/batch-delete", "admin/ipBan", "batchDelete"],
				["GET", "/api/admin/ip-bans/check-ip", "admin/ipBan", "checkIp"],
				// Censor Words
				["GET", "/api/admin/censor-words", "admin/censorWord", "list"],
				["POST", "/api/admin/censor-words", "admin/censorWord", "create"],
				["GET", "/api/admin/censor-words/1", "admin/censorWord", "getById"],
				["PATCH", "/api/admin/censor-words/1", "admin/censorWord", "update"],
				["DELETE", "/api/admin/censor-words/1", "admin/censorWord", "remove"],
				["POST", "/api/admin/censor-words/batch-delete", "admin/censorWord", "batchDelete"],
				["POST", "/api/admin/censor-words/test", "admin/censorWord", "test"],
				// Stats
				["GET", "/api/admin/stats", "admin/stats", "handleStats"],
				// Settings
				["GET", "/api/admin/settings", "admin/settings", "list"],
				["PUT", "/api/admin/settings", "admin/settings", "bulkUpdate"],
				// Reports
				["GET", "/api/admin/reports", "admin/report", "list"],
				["GET", "/api/admin/reports/1", "admin/report", "getById"],
				["PATCH", "/api/admin/reports/1", "admin/report", "update"],
				["POST", "/api/admin/reports/batch-delete", "admin/report", "batchDelete"],
				// Admin Logs
				["GET", "/api/admin/admin-logs", "admin/adminLog", "list"],
				["GET", "/api/admin/admin-logs/1", "admin/adminLog", "getById"],
				// Announcements
				["GET", "/api/admin/announcements", "admin/announcement", "list"],
				["POST", "/api/admin/announcements", "admin/announcement", "create"],
				["GET", "/api/admin/announcements/1", "admin/announcement", "getById"],
				["PATCH", "/api/admin/announcements/1", "admin/announcement", "update"],
				["DELETE", "/api/admin/announcements/1", "admin/announcement", "remove"],
				["POST", "/api/admin/announcements/batch-delete", "admin/announcement", "batchDelete"],
				// Today-visits (P5)
				["GET", "/api/admin/analytics/today/visits", "admin/todayVisits", "getTodayVisitsKpi"],
				[
					"GET",
					"/api/admin/analytics/today/visits/list",
					"admin/todayVisits",
					"getTodayVisitsList",
				],
			])("%s %s → %s.%s", async (method, path, mod, fn) => {
				const request = makeAdminRequest(method, path);
				const response = await worker.fetch(request, makeEnv(), makeCtx());
				expect(response.status).toBe(200);
				await expectHandlerCalled(mod, fn);
			});
		});
	});
});
