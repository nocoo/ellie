// components/admin/admin-user-filters.tsx — URL-driven user management filters
// Ref: 04c §用户管理 — search by username, filter by role/status
//
// Client component: navigates via URL search params on change.
// Same pattern as ThreadSortControls.

"use client";

import { UserRole, UserStatus } from "@/models/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

const ROLE_OPTIONS = [
	{ value: "", label: "All Roles" },
	{ value: String(UserRole.Admin), label: "Admin" },
	{ value: String(UserRole.SuperMod), label: "Super Mod" },
	{ value: String(UserRole.Mod), label: "Moderator" },
	{ value: String(UserRole.User), label: "Member" },
];

const STATUS_OPTIONS = [
	{ value: "", label: "All Status" },
	{ value: String(UserStatus.Active), label: "Active" },
	{ value: String(UserStatus.Banned), label: "Banned" },
	{ value: String(UserStatus.Archived), label: "Archived" },
];

export interface AdminUserFiltersProps {
	search: string;
	role: string;
	status: string;
}

export function AdminUserFilters({ search, role, status }: AdminUserFiltersProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [searchInput, setSearchInput] = useState(search);

	const navigate = useCallback(
		(params: Record<string, string | null>) => {
			const sp = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(params)) {
				if (value === null || value === "") {
					sp.delete(key);
				} else {
					sp.set(key, value);
				}
			}
			const qs = sp.toString();
			router.push(qs ? `${pathname}?${qs}` : pathname);
		},
		[router, pathname, searchParams],
	);

	const handleSearch = () => {
		navigate({ search: searchInput || null });
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") handleSearch();
	};

	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* Search */}
			<div className="flex items-center gap-1">
				<input
					type="text"
					placeholder="Search username..."
					value={searchInput}
					onChange={(e) => setSearchInput(e.target.value)}
					onKeyDown={handleKeyDown}
					className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
				/>
				<button
					type="button"
					onClick={handleSearch}
					className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
				>
					Search
				</button>
			</div>

			{/* Role filter */}
			<select
				value={role}
				onChange={(e) => navigate({ role: e.target.value || null })}
				className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
			>
				{ROLE_OPTIONS.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>

			{/* Status filter */}
			<select
				value={status}
				onChange={(e) => navigate({ status: e.target.value || null })}
				className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
			>
				{STATUS_OPTIONS.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
		</div>
	);
}
