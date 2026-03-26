// Admin user management page — user list with role/status info
// Ref: 04c §用户管理 — search, filter, ban/unban, role change
//
// Server component: fetches user list at request time.
// Phase 2: Add client-side interactions for ban/unban/role change.

import { UserAvatar } from "@/components/user-avatar";
import { createRepositories } from "@/data/index";
import { UserRole, UserStatus } from "@/models/types";
import { DEFAULT_FILTERS, fetchUserList } from "@/viewmodels/admin/user-management";

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

export default async function AdminUsersPage() {
	const repos = createRepositories();
	const result = await fetchUserList(repos, DEFAULT_FILTERS);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">User Management</h2>

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
								</tr>
							))}
							{result.items.length === 0 && (
								<tr>
									<td colSpan={5} className="p-8 text-center text-muted-foreground">
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
