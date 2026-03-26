// data/repositories/attachment.repository.ts — Mock AttachmentRepository implementation
// Ref: 04a §AttachmentRepository

import type { MockDataStore } from "@/data/mock/store";
import type { Attachment } from "@/models/types";
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
