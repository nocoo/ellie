import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock the api-client module before importing the module under test
const mockPatch = mock(async () => ({ data: undefined, meta: {} }));
const mockDelete = mock(async () => ({ data: undefined, meta: {} }));

mock.module("../../../apps/web/src/lib/api-client", () => ({
	apiClient: {
		patch: mockPatch,
		delete: mockDelete,
	},
}));

import {
	setThreadSticky,
	setThreadDigest,
	setThreadClosed,
	moveThread,
	setThreadHighlight,
	deleteThread,
	deletePost,
	editPost,
	deleteMyPost,
	deleteMyThread,
	editMyPost,
} from "../../../apps/web/src/lib/moderation-api";

beforeEach(() => {
	mockPatch.mockClear();
	mockDelete.mockClear();
});

describe("moderation-api", () => {
	// ─── Thread Management ─────────────────────────────────

	describe("setThreadSticky", () => {
		it("calls patch with correct URL and level", async () => {
			await setThreadSticky(42, "forum");
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/42/sticky", { level: "forum" });
		});

		it("supports 'none' level", async () => {
			await setThreadSticky(1, "none");
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/1/sticky", { level: "none" });
		});

		it("supports 'global' level", async () => {
			await setThreadSticky(99, "global");
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/99/sticky", { level: "global" });
		});
	});

	describe("setThreadDigest", () => {
		it("calls patch with correct URL and level", async () => {
			await setThreadDigest(10, 3);
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/10/digest", { level: 3 });
		});
	});

	describe("setThreadClosed", () => {
		it("calls patch with closed=true", async () => {
			await setThreadClosed(5, true);
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/5/close", { closed: true });
		});

		it("calls patch with closed=false", async () => {
			await setThreadClosed(5, false);
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/5/close", { closed: false });
		});
	});

	describe("moveThread", () => {
		it("calls patch with targetForumId", async () => {
			await moveThread(7, 20);
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/7/move", { targetForumId: 20 });
		});
	});

	describe("setThreadHighlight", () => {
		it("calls patch with highlight options", async () => {
			const options = { color: "#ff0000", bold: true, italic: false, underline: true };
			await setThreadHighlight(3, options);
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/3/highlight", options);
		});

		it("supports null color (remove highlight)", async () => {
			await setThreadHighlight(3, { color: null });
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/threads/3/highlight", { color: null });
		});
	});

	describe("deleteThread", () => {
		it("calls delete with correct URL", async () => {
			await deleteThread(15);
			expect(mockDelete).toHaveBeenCalledWith("/api/v1/moderation/threads/15");
		});
	});

	// ─── Post Management ───────────────────────────────────

	describe("deletePost", () => {
		it("calls delete with correct URL", async () => {
			await deletePost(100);
			expect(mockDelete).toHaveBeenCalledWith("/api/v1/moderation/posts/100");
		});
	});

	describe("editPost", () => {
		it("calls patch with content", async () => {
			await editPost(50, "updated content");
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/moderation/posts/50", { content: "updated content" });
		});
	});

	// ─── User Self-Service ─────────────────────────────────

	describe("deleteMyPost", () => {
		it("calls delete with /me/ URL", async () => {
			await deleteMyPost(200);
			expect(mockDelete).toHaveBeenCalledWith("/api/v1/me/posts/200");
		});
	});

	describe("deleteMyThread", () => {
		it("calls delete with /me/ URL", async () => {
			await deleteMyThread(300);
			expect(mockDelete).toHaveBeenCalledWith("/api/v1/me/threads/300");
		});
	});

	describe("editMyPost", () => {
		it("calls patch with /me/ URL and content", async () => {
			await editMyPost(400, "my updated post");
			expect(mockPatch).toHaveBeenCalledWith("/api/v1/me/posts/400", { content: "my updated post" });
		});
	});
});
