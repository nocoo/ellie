// data/repositories/forum.repository.ts — Mock ForumRepository implementation
// Ref: 04a §ForumRepository

import { MOCK_FORUMS } from "@/data/mock/forums";
import type { Forum } from "@/models/types";
import type { ForumRepository, UpdateForumInput } from "./types";

export function createMockForumRepository(): ForumRepository {
	// Clone mock data so mutations don't affect the original
	const forums: Forum[] = MOCK_FORUMS.map((f) => ({ ...f }));

	return {
		async listAll(): Promise<Forum[]> {
			return [...forums];
		},

		async getById(id: number): Promise<Forum | null> {
			return forums.find((f) => f.id === id) ?? null;
		},

		async update(id: number, input: UpdateForumInput): Promise<void> {
			const forum = forums.find((f) => f.id === id);
			if (!forum) throw new Error(`Forum ${id} not found`);
			if (input.name !== undefined) forum.name = input.name;
			if (input.description !== undefined) forum.description = input.description;
			if (input.icon !== undefined) forum.icon = input.icon;
			if (input.status !== undefined) forum.status = input.status;
			if (input.displayOrder !== undefined) forum.displayOrder = input.displayOrder;
		},
	};
}
