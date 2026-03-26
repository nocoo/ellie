// data/repositories/user.repository.ts — Mock UserRepository implementation
// Ref: 04a §UserRepository

import type { MockDataStore } from "@/data/mock/store";
import { decodeCursor, encodeCursor } from "@/models/pagination";
import type { User, UserRole, UserStatus } from "@/models/types";
import type { PaginatedResult, UserListParams, UserRepository } from "./types";

type UserSortKey = "regDate" | "lastLogin";

function getUserSortKey(sort: "newest" | "lastLogin"): UserSortKey {
	return sort === "lastLogin" ? "lastLogin" : "regDate";
}

export function createMockUserRepository(store: MockDataStore): UserRepository {
	return {
		async list(params: UserListParams): Promise<PaginatedResult<User>> {
			let filtered = [...store.users];

			if (params.search) {
				const query = params.search.toLowerCase();
				filtered = filtered.filter((u) => u.username.toLowerCase().includes(query));
			}
			if (params.role !== undefined) filtered = filtered.filter((u) => u.role === params.role);
			if (params.status !== undefined)
				filtered = filtered.filter((u) => u.status === params.status);
			if (params.lastLoginAfter !== undefined)
				filtered = filtered.filter((u) => u.lastLogin >= params.lastLoginAfter!);

			const sort = params.sort ?? "newest";
			const sortKey = getUserSortKey(sort);
			filtered.sort((a, b) => b[sortKey] - a[sortKey] || b.id - a.id);

			const limit = params.limit ?? 20;

			// Cursor-based pagination
			let page = filtered;
			if (params.cursor) {
				const payload = decodeCursor(params.cursor);
				if (payload) {
					if (params.direction === "backward") {
						page = filtered.filter(
							(u) =>
								u[sortKey] > payload.sortValue ||
								(u[sortKey] === payload.sortValue && u.id > payload.id),
						);
						page = page.slice(-limit);
					} else {
						page = filtered.filter(
							(u) =>
								u[sortKey] < payload.sortValue ||
								(u[sortKey] === payload.sortValue && u.id < payload.id),
						);
					}
				}
			}

			const sliced = page.slice(0, limit);
			const nextCursor =
				sliced.length === limit && page.length > limit
					? encodeCursor({
							sortValue: sliced[sliced.length - 1][sortKey],
							id: sliced[sliced.length - 1].id,
						})
					: null;
			const prevCursor =
				params.cursor && sliced.length > 0
					? encodeCursor({ sortValue: sliced[0][sortKey], id: sliced[0].id })
					: null;

			return { items: sliced, nextCursor, prevCursor, total: filtered.length };
		},

		async getById(id: number): Promise<User | null> {
			return store.users.find((u) => u.id === id) ?? null;
		},

		async setStatus(id: number, status: UserStatus): Promise<void> {
			const user = store.users.find((u) => u.id === id);
			if (!user) throw new Error(`User ${id} not found`);
			user.status = status;
		},

		async setRole(id: number, role: UserRole): Promise<void> {
			const user = store.users.find((u) => u.id === id);
			if (!user) throw new Error(`User ${id} not found`);
			user.role = role;
		},
	};
}
