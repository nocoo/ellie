import { createMockAttachmentRepository, createMockDataStore } from "@ellie/test-mocks";
import { describe, expect, it } from "vitest";

describe("createMockAttachmentRepository", () => {
	const store = createMockDataStore();
	const repo = createMockAttachmentRepository(store);

	// ─── listByPostId ──────────────────────────────────────

	describe("listByPostId", () => {
		it("returns attachments for a given postId", async () => {
			const attachments = await repo.listByPostId(100001);
			expect(attachments.length).toBe(2);
			expect(attachments.every((a) => a.postId === 100001)).toBe(true);
		});

		it("returns attachment for post 100010", async () => {
			const attachments = await repo.listByPostId(100010);
			expect(attachments.length).toBe(1);
			expect(attachments[0].id).toBe(1001);
			expect(attachments[0].filename).toBe("高等数学复习资料.pdf");
		});

		it("returns empty array when no attachments match", async () => {
			const attachments = await repo.listByPostId(99999);
			expect(attachments).toEqual([]);
		});

		it("returns empty array for post with no attachments", async () => {
			// Post 100002 (zhangsan reply in thread 50001) has no attachments
			const attachments = await repo.listByPostId(100002);
			expect(attachments).toEqual([]);
		});
	});

	// ─── listByThreadId ────────────────────────────────────

	describe("listByThreadId", () => {
		it("returns attachments for a given threadId", async () => {
			const attachments = await repo.listByThreadId(50001);
			expect(attachments.length).toBe(2);
			expect(attachments.every((a) => a.threadId === 50001)).toBe(true);
		});

		it("returns attachment for thread 50002", async () => {
			const attachments = await repo.listByThreadId(50002);
			expect(attachments.length).toBe(1);
			expect(attachments[0].id).toBe(1001);
		});

		it("returns attachment for thread 50010", async () => {
			const attachments = await repo.listByThreadId(50010);
			expect(attachments.length).toBe(1);
			expect(attachments[0].isImage).toBe(true);
			expect(attachments[0].filename).toBe("ts59-features.png");
		});

		it("returns empty array when no attachments match", async () => {
			const attachments = await repo.listByThreadId(99999);
			expect(attachments).toEqual([]);
		});

		it("returns empty array for thread with no attachments", async () => {
			// Thread 50012 has no attachments in seed data
			const attachments = await repo.listByThreadId(50012);
			expect(attachments).toEqual([]);
		});
	});
});
