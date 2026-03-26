// data/repositories/forum.repository.ts — Mock ForumRepository implementation
// Ref: 04a §ForumRepository

import type { Forum } from "@ellie/types";
import type { MockDataStore } from "./mock/store";
import type { ForumRepository, UpdateForumInput } from "./types";

export function createMockForumRepository(store: MockDataStore): ForumRepository {
	return {
		async listAll(): Promise<Forum[]> {
			return [...store.forums];
		},

		async getById(id: number): Promise<Forum | null> {
			return store.forums.find((f) => f.id === id) ?? null;
		},

		async update(id: number, input: UpdateForumInput): Promise<void> {
			const forum = store.forums.find((f) => f.id === id);
			if (!forum) throw new Error(`Forum ${id} not found`);
			if (input.name !== undefined) forum.name = input.name;
			if (input.description !== undefined) forum.description = input.description;
			if (input.icon !== undefined) forum.icon = input.icon;
			if (input.status !== undefined) forum.status = input.status;
			if (input.displayOrder !== undefined) forum.displayOrder = input.displayOrder;
		},
	};
}
