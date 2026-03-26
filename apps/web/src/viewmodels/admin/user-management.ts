// viewmodels/admin/user-management.ts — User Management ViewModel
// Ref: 04c §用户管理 — search, filter, ban/unban, role change

import type { Repositories } from "@ellie/repositories";
import type { PaginatedResult } from "@ellie/repositories";
import { UserStatus } from "@ellie/types";
import type { User, UserRole } from "@ellie/types";

export interface UserManagementFilters {
	search: string;
	role: UserRole | null;
	status: UserStatus | null;
}

export interface UserManagementActions {
	banUser(id: number): Promise<void>;
	unbanUser(id: number): Promise<void>;
	changeRole(id: number, role: UserRole): Promise<void>;
}

export interface UserManagementResult {
	result: PaginatedResult<User>;
	actions: UserManagementActions;
}

/** Default filters — show all users */
export const DEFAULT_FILTERS: UserManagementFilters = {
	search: "",
	role: null,
	status: null,
};

/** Fetch user list with filters */
export async function fetchUserList(
	repos: Repositories,
	filters: UserManagementFilters,
	cursor?: string,
	direction?: "forward" | "backward",
	limit = 20,
): Promise<PaginatedResult<User>> {
	return repos.users.list({
		search: filters.search || undefined,
		role: filters.role ?? undefined,
		status: filters.status ?? undefined,
		cursor,
		direction,
		limit,
	});
}

/** Create user management actions bound to a repository */
export function createUserActions(repos: Repositories): UserManagementActions {
	return {
		async banUser(id: number) {
			await repos.users.setStatus(id, UserStatus.Banned);
		},
		async unbanUser(id: number) {
			await repos.users.setStatus(id, UserStatus.Active);
		},
		async changeRole(id: number, role: UserRole) {
			await repos.users.setRole(id, role);
		},
	};
}
