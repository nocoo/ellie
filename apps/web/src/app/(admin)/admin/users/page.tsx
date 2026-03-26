// Admin user management page — full user list with search, filter, actions
// Ref: 04c §用户管理 — search, filter by role/status, ban/unban, role change
//
// Server component: reads filters from URL searchParams, fetches filtered user list.
// Filter controls and action buttons are client components.

import { AdminUserActions } from "@/components/admin/admin-user-actions";
import { AdminUserFilters } from "@/components/admin/admin-user-filters";
import { UserAvatar } from "@/components/user-avatar";
import type { UserManagementFilters } from "@/viewmodels/admin/user-management";
import { fetchUserList } from "@/viewmodels/admin/user-management";
import { createRepositories } from "@ellie/repositories";
import { UserRole, UserStatus } from "@ellie/types";

const ROLE_LABELS: Record<number, string> = {
	[UserRole.Admin]: "Admin",
	[UserRole.SuperMod]: "Super Mod",
	[UserRole.Mod]: "Moderator",
	[UserRole.User]: "Member",
};

const STATUS_LABELS: Record<number, string> = {
	[UserStatus.Active]: "Active",
	[UserStatus.Banned]: "Banned",
	[UserStatus.Archived]: "Archived",
};

interface PageProps {
	searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
	const params = await searchParams;
	const repos = createRepositories();

	// Build filters from URL searchParams
	const filters: UserManagementFilters = {
		search: params.search ?? "",
		role: params.role !== undefined ? (Number(params.role) as UserRole) : null,
		status: params.status !== undefined ? (Number(params.status) as UserStatus) : null,
	};

	const result = await fetchUserList(repos, filters);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">User Management</h2>

			{/* Filters: search + role + status */}
			<AdminUserFilters
				search={filters.search}
				role={params.role ?? ""}
				status={params.status ?? ""}
			/>

			<div className="rounded-[14px] bg-card">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left text-muted-foreground">
								<th className="p-4">User</th>
								<th className="p-4">Email</th>
								<th className="p-4">Role</th>
								<th className="p-4">Status</th>
								<th className="p-4 text-right">Posts</th>
								<th className="p-4 text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{result.items.map((user) => (
								<tr key={user.id} className="border-b border-border last:border-0">
									<td className="p-4">
										<div className="flex items-center gap-2">
											<UserAvatar avatar={user.avatar} username={user.username} size="sm" />
											<span className="font-medium">{user.username}</span>
										</div>
									</td>
									<td className="p-4 text-muted-foreground">{user.email}</td>
									<td className="p-4">
										<span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
											{ROLE_LABELS[user.role] ?? `Role ${user.role}`}
										</span>
									</td>
									<td className="p-4">
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${
												user.status === UserStatus.Active
													? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
													: user.status === UserStatus.Banned
														? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
														: "bg-secondary text-muted-foreground"
											}`}
										>
											{STATUS_LABELS[user.status] ?? `Status ${user.status}`}
										</span>
									</td>
									<td className="p-4 text-right text-muted-foreground">{user.posts}</td>
									<td className="p-4 text-right">
										<AdminUserActions userId={user.id} status={user.status} role={user.role} />
									</td>
								</tr>
							))}
							{result.items.length === 0 && (
								<tr>
									<td colSpan={6} className="p-8 text-center text-muted-foreground">
										No users found.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Showing {result.items.length} of {result.total} users
			</p>
		</div>
	);
}
