import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	batchDeleteIpBans,
	buildIpBanSearchParams,
	checkIp,
	createIpBan,
	deleteIpBan,
	fetchIpBan,
	fetchIpBans,
	formatExpiry,
	updateIpBan,
} from "../../../../apps/web/src/viewmodels/admin/ip-bans";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	mockFetchFn = mock(() =>
		Promise.resolve(
			mockJsonResponse({
				data: [],
				meta: { timestamp: 1711612800000, requestId: "r1", total: 0, page: 1, limit: 20, pages: 0 },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("buildIpBanSearchParams", () => {
	it("includes present values", () => {
		const params = buildIpBanSearchParams({ page: 1, limit: 20, ip: "192.168" });
		expect(params.page).toBe(1);
		expect(params.ip).toBe("192.168");
	});

	it("omits empty and undefined values", () => {
		const params = buildIpBanSearchParams({ ip: "", reason: undefined });
		expect(params.ip).toBeUndefined();
		expect(params.reason).toBeUndefined();
	});
});

describe("formatExpiry", () => {
	it("returns 'Never' for null", () => {
		expect(formatExpiry(null)).toBe("Never");
	});

	it("returns a formatted string for a date", () => {
		const result = formatExpiry("2026-12-31T23:59:59Z");
		expect(result).toBeTruthy();
		expect(result).not.toBe("Never");
	});
});

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

describe("fetchIpBans", () => {
	it("calls GET /api/admin/ip-bans with params", async () => {
		await fetchIpBans({ page: 2, ip: "10.0" });
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/ip-bans");
		expect(url).toContain("ip=10.0");
	});
});

describe("fetchIpBan", () => {
	it("calls GET /api/admin/ip-bans/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 5, ip: "1.2.3.4", reason: "spam" }, meta: {} }),
			),
		);
		const ban = await fetchIpBan(5);
		expect(ban.id).toBe(5);
		expect(ban.ip).toBe("1.2.3.4");
	});
});

describe("createIpBan", () => {
	it("calls POST /api/admin/ip-bans", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 10, ip: "5.6.7.8", reason: "abuse" }, meta: {} }),
			),
		);
		const ban = await createIpBan({ ip: "5.6.7.8", reason: "abuse" });
		expect(ban.id).toBe(10);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/ip-bans");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ ip: "5.6.7.8", reason: "abuse" }));
	});
});

describe("updateIpBan", () => {
	it("calls PATCH /api/admin/ip-bans/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 5, ip: "1.2.3.4", reason: "updated" }, meta: {} }),
			),
		);
		await updateIpBan(5, { reason: "updated" });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/ip-bans/5");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deleteIpBan", () => {
	it("calls DELETE /api/admin/ip-bans/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true }, meta: {} })),
		);
		const result = await deleteIpBan(5);
		expect(result.deleted).toBe(true);
	});
});

describe("batchDeleteIpBans", () => {
	it("calls POST /api/admin/ip-bans/batch-delete", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);
		const result = await batchDeleteIpBans([1, 2, 3]);
		expect(result.affected).toBe(3);
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
	});
});

describe("checkIp", () => {
	it("calls GET /api/admin/ip-bans/check-ip with ip param", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: { banned: true, matchingBans: [{ id: 1, ip: "10.0.0.0/8" }] },
					meta: {},
				}),
			),
		);
		const result = await checkIp("10.0.0.1");
		expect(result.banned).toBe(true);
		expect(result.matchingBans).toHaveLength(1);
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("ip=10.0.0.1");
	});
});
