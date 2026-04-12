// data/repositories/attachment.repository.ts — Mock AttachmentRepository implementation
// Ref: 04a §AttachmentRepository

import type { Attachment } from "@ellie/types";
import type { MockDataStore } from "./mock/store";
import type { AttachmentRepository } from "./types";

export function createMockAttachmentRepository(store: MockDataStore): AttachmentRepository {
	return {
		async listByPostId(postId: number): Promise<Attachment[]> {
			return store.attachments.filter((a) => a.postId === postId);
		},

		async listByThreadId(threadId: number): Promise<Attachment[]> {
			return store.attachments.filter((a) => a.threadId === threadId);
		},
	};
}
