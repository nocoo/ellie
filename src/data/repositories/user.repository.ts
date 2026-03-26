// data/repositories/user.repository.ts — Mock UserRepository implementation
// Ref: 04a §UserRepository

import { MOCK_USERS } from "@/data/mock/users";
import { encodeCursor } from "@/models/pagination";
import type { User, UserRole, UserStatus } from "@/models/types";
import type { PaginatedResult, UserListParams, UserRepository } from "./types";

export function createMockUserRepository(): UserRepository {
	const users: User[] = MOCK_USERS.map((u) => ({ ...u }));

	function paginate(items: User[], limit: number): PaginatedResult<User> {
		const page = items.slice(0, limit);
		return {
			items: page,
			nextCursor:
				page.length === limit && items.length > limit
					? encodeCursor({ sortValue: page[page.length - 1].regDate, id: page[page.length - 1].id })
					: null,
			prevCursor: null,
			total: items.length,
		};
	}

	return {
		async list(params: UserListParams): Promise<PaginatedResult<User>> {
			let filtered = [...users];

			if (params.search) {
				const query = params.search.toLowerCase();
				filtered = filtered.filter((u) => u.username.toLowerCase().includes(query));
			}
			if (params.role !== undefined) filtered = filtered.filter((u) => u.role === params.role);
			if (params.status !== undefined)
				filtered = filtered.filter((u) => u.status === params.status);
			if (params.lastLoginAfter !== undefined)
				filtered = filtered.filter((u) => u.lastLogin >= params.lastLoginAfter!);

			// Sort
			const sort = params.sort ?? "newest";
			if (sort === "newest") filtered.sort((a, b) => b.regDate - a.regDate);
			else if (sort === "lastLogin") filtered.sort((a, b) => b.lastLogin - a.lastLogin);

			const limit = params.limit ?? 20;
			return paginate(filtered, limit);
		},

		async getById(id: number): Promise<User | null> {
			return users.find((u) => u.id === id) ?? null;
		},

		async setStatus(id: number, status: UserStatus): Promise<void> {
			const user = users.find((u) => u.id === id);
			if (!user) throw new Error(`User ${id} not found`);
			user.status = status;
		},

		async setRole(id: number, role: UserRole): Promise<void> {
			const user = users.find((u) => u.id === id);
			if (!user) throw new Error(`User ${id} not found`);
			user.role = role;
		},
	};
}
