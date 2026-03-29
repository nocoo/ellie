import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	batchDeleteAttachments,
	buildAttachmentSearchParams,
	deleteAttachment,
	fetchAttachment,
	fetchAttachments,
	formatFileSize,
} from "../../../../apps/web/src/viewmodels/admin/attachments";

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

describe("buildAttachmentSearchParams", () => {
	it("includes present values", () => {
		const params = buildAttachmentSearchParams({ page: 1, limit: 20, postId: 5 });
		expect(params.page).toBe(1);
		expect(params.postId).toBe(5);
	});

	it("omits empty and null values", () => {
		const params = buildAttachmentSearchParams({ postId: undefined, threadId: undefined });
		expect(params.postId).toBeUndefined();
		expect(params.threadId).toBeUndefined();
	});

	it("includes isImage filter", () => {
		const params = buildAttachmentSearchParams({ isImage: true });
		expect(params.isImage).toBe(true);
	});
});

describe("formatFileSize", () => {
	it("formats 0 bytes", () => {
		expect(formatFileSize(0)).toBe("0 B");
	});

	it("formats bytes", () => {
		expect(formatFileSize(500)).toBe("500 B");
	});

	it("formats kilobytes", () => {
		expect(formatFileSize(1024)).toBe("1 KB");
		expect(formatFileSize(1536)).toBe("1.5 KB");
	});

	it("formats megabytes", () => {
		expect(formatFileSize(1048576)).toBe("1 MB");
		expect(formatFileSize(2621440)).toBe("2.5 MB");
	});

	it("formats gigabytes", () => {
		expect(formatFileSize(1073741824)).toBe("1 GB");
	});
});

describe("fetchAttachments", () => {
	it("calls GET /api/admin/attachments with params", async () => {
		await fetchAttachments({ page: 2, threadId: 10 });
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/attachments");
		expect(url).toContain("threadId=10");
	});
});

describe("fetchAttachment", () => {
	it("calls GET /api/admin/attachments/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { aid: 10, filename: "test.png" }, meta: {} })),
		);
		const attachment = await fetchAttachment(10);
		expect(attachment.aid).toBe(10);
	});
});

describe("deleteAttachment", () => {
	it("calls DELETE /api/admin/attachments/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true }, meta: {} })),
		);
		const result = await deleteAttachment(10);
		expect(result.deleted).toBe(true);
	});
});

describe("batchDeleteAttachments", () => {
	it("calls POST /api/admin/attachments/batch-delete", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);
		const result = await batchDeleteAttachments([1, 2, 3]);
		expect(result.affected).toBe(3);
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
	});
});
