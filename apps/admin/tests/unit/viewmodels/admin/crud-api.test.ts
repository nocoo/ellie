import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		getList: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	batchDeleteAttachments,
	deleteAttachment,
	fetchAttachment,
	fetchAttachments,
} from "@/viewmodels/admin/attachments";
import {
	batchDeleteCensorWords,
	createCensorWord,
	deleteCensorWord,
	fetchCensorWord,
	fetchCensorWords,
	testContent,
	updateCensorWord,
} from "@/viewmodels/admin/censor-words";
import {
	batchDeletePosts,
	deletePost,
	fetchPost,
	fetchPosts,
	updatePost,
} from "@/viewmodels/admin/posts";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("censor-words API", () => {
	it("fetchCensorWords calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchCensorWords({ find: "bad" });
		expect(mockGetList).toHaveBeenCalledWith(
			"/api/admin/censor-words",
			expect.objectContaining({ find: "bad" }),
		);
	});

	it("fetchCensorWord calls get by id", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const word = await fetchCensorWord(1);
		expect(word.id).toBe(1);
	});

	it("createCensorWord calls post", async () => {
		mockPost.mockResolvedValue({ data: { id: 1, find: "bad" } });
		const word = await createCensorWord({ find: "bad" });
		expect(mockPost).toHaveBeenCalledWith("/api/admin/censor-words", { find: "bad" });
		expect(word.find).toBe("bad");
	});

	it("updateCensorWord calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1 } });
		await updateCensorWord(1, { replacement: "***" });
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/censor-words/1", { replacement: "***" });
	});

	it("deleteCensorWord calls delete", async () => {
		mockDelete.mockResolvedValue({ data: undefined });
		await deleteCensorWord(1);
		expect(mockDelete).toHaveBeenCalledWith("/api/admin/censor-words/1");
	});

	it("batchDeleteCensorWords calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2 } });
		const r = await batchDeleteCensorWords([1, 2]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/censor-words/batch-delete", { ids: [1, 2] });
		expect(r.affected).toBe(2);
	});

	it("testContent calls post", async () => {
		mockPost.mockResolvedValue({
			data: { original: "bad word", censored: "*** word", matches: ["bad"] },
		});
		const r = await testContent("bad word");
		expect(mockPost).toHaveBeenCalledWith("/api/admin/censor-words/test", { content: "bad word" });
		expect(r.censored).toBe("*** word");
	});
});

describe("attachments API", () => {
	it("fetchAttachments calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchAttachments({ threadId: 1 });
		expect(mockGetList).toHaveBeenCalled();
	});

	it("fetchAttachment calls get", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const a = await fetchAttachment(1);
		expect(a.id).toBe(1);
	});

	it("deleteAttachment calls delete", async () => {
		mockDelete.mockResolvedValue({ data: { deleted: true } });
		const r = await deleteAttachment(1);
		expect(r.deleted).toBe(true);
	});

	it("batchDeleteAttachments calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2 } });
		const r = await batchDeleteAttachments([1, 2]);
		expect(r.affected).toBe(2);
	});
});

describe("posts API", () => {
	it("fetchPosts calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchPosts({ threadId: 1, page: 1 });
		expect(mockGetList).toHaveBeenCalled();
	});

	it("fetchPost calls get", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const p = await fetchPost(1);
		expect(p.id).toBe(1);
	});

	it("updatePost calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1, content: "updated" } });
		const p = await updatePost(1, { content: "updated" });
		expect(p.content).toBe("updated");
	});

	it("deletePost calls delete", async () => {
		mockDelete.mockResolvedValue({ data: { deleted: true } });
		const r = await deletePost(1);
		expect(r.deleted).toBe(true);
	});

	it("batchDeletePosts calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 3, skipped: 0 } });
		const r = await batchDeletePosts([1, 2, 3]);
		expect(r.affected).toBe(3);
	});
});
