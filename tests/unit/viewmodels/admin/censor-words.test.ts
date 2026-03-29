import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	batchDeleteCensorWords,
	buildCensorWordSearchParams,
	createCensorWord,
	deleteCensorWord,
	fetchCensorWord,
	fetchCensorWords,
	replacementDisplay,
	testContent,
	updateCensorWord,
} from "../../../../apps/web/src/viewmodels/admin/censor-words";

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

describe("buildCensorWordSearchParams", () => {
	it("includes present values", () => {
		const params = buildCensorWordSearchParams({ page: 1, limit: 20, find: "bad" });
		expect(params.page).toBe(1);
		expect(params.find).toBe("bad");
	});

	it("omits empty and undefined values", () => {
		const params = buildCensorWordSearchParams({ find: "", action: undefined });
		expect(params.find).toBeUndefined();
		expect(params.action).toBeUndefined();
	});
});

describe("replacementDisplay", () => {
	it("returns replacement when provided", () => {
		expect(replacementDisplay("####")).toBe("####");
	});

	it("returns *** when replacement is empty", () => {
		expect(replacementDisplay("")).toBe("***");
	});
});

describe("fetchCensorWords", () => {
	it("calls GET /api/admin/censor-words with params", async () => {
		await fetchCensorWords({ page: 2, find: "test" });
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/censor-words");
		expect(url).toContain("find=test");
	});
});

describe("fetchCensorWord", () => {
	it("calls GET /api/admin/censor-words/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 5, word: "bad", replacement: "***" }, meta: {} }),
			),
		);
		const cw = await fetchCensorWord(5);
		expect(cw.id).toBe(5);
		expect(cw.word).toBe("bad");
	});
});

describe("createCensorWord", () => {
	it("calls POST /api/admin/censor-words", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 10, word: "bad", replacement: "***" }, meta: {} }),
			),
		);
		const cw = await createCensorWord({ word: "bad" });
		expect(cw.id).toBe(10);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/censor-words");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ word: "bad" }));
	});
});

describe("updateCensorWord", () => {
	it("calls PATCH /api/admin/censor-words/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 5, word: "bad", replacement: "---" }, meta: {} }),
			),
		);
		await updateCensorWord(5, { replacement: "---" });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/censor-words/5");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deleteCensorWord", () => {
	it("calls DELETE /api/admin/censor-words/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: null, meta: {} })),
		);
		await deleteCensorWord(5);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/censor-words/5");
		expect(opts.method).toBe("DELETE");
	});
});

describe("batchDeleteCensorWords", () => {
	it("calls POST /api/admin/censor-words/batch-delete", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);
		const result = await batchDeleteCensorWords([1, 2, 3]);
		expect(result.affected).toBe(3);
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
	});
});

describe("testContent", () => {
	it("calls POST /api/admin/censor-words/test", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: { original: "this is bad", censored: "this is ***", matches: ["bad"] },
					meta: {},
				}),
			),
		);
		const result = await testContent("this is bad");
		expect(result.original).toBe("this is bad");
		expect(result.censored).toBe("this is ***");
		expect(result.matches).toEqual(["bad"]);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/censor-words/test");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ content: "this is bad" }));
	});
});
