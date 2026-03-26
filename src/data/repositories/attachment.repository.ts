// data/repositories/attachment.repository.ts — Mock AttachmentRepository implementation
// Ref: 04a §AttachmentRepository

import { MOCK_ATTACHMENTS } from "@/data/mock/attachments";
import type { Attachment } from "@/models/types";
import type { AttachmentRepository } from "./types";

export function createMockAttachmentRepository(): AttachmentRepository {
	const attachments: Attachment[] = MOCK_ATTACHMENTS.map((a) => ({ ...a }));

	return {
		async listByPostId(postId: number): Promise<Attachment[]> {
			return attachments.filter((a) => a.postId === postId);
		},

		async listByThreadId(threadId: number): Promise<Attachment[]> {
			return attachments.filter((a) => a.threadId === threadId);
		},
	};
}
