import { beforeEach, describe, expect, test } from "bun:test";
import { createMockAttachmentRepository } from "@/data/repositories/attachment.repository";
import type { AttachmentRepository } from "@/data/repositories/types";

let repo: AttachmentRepository;

beforeEach(() => {
	repo = createMockAttachmentRepository();
});

describe("MockAttachmentRepository", () => {
	describe("listByPostId", () => {
		test("returns attachments for a post", async () => {
			// Post 100001 has attachments 1002, 1003 in mock data
			const result = await repo.listByPostId(100001);
			expect(result.length).toBeGreaterThan(0);
			for (const a of result) {
				expect(a.postId).toBe(100001);
			}
		});

		test("returns empty for post with no attachments", async () => {
			const result = await repo.listByPostId(999999);
			expect(result).toHaveLength(0);
		});
	});

	describe("listByThreadId", () => {
		test("returns attachments for a thread", async () => {
			// Thread 50001 has attachments 1002, 1003 in mock data
			const result = await repo.listByThreadId(50001);
			expect(result.length).toBeGreaterThan(0);
			for (const a of result) {
				expect(a.threadId).toBe(50001);
			}
		});

		test("returns empty for thread with no attachments", async () => {
			const result = await repo.listByThreadId(999999);
			expect(result).toHaveLength(0);
		});
	});
});
