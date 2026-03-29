"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type User,
	type UserUpdate,
	banUser,
	batchSetStatus,
	nukeUser,
	roleLabel,
	statusLabel,
	updateUser,
} from "@/viewmodels/admin/users";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "Search users...", type: "search" },
	{
		key: "status",
		label: "Status",
		type: "select",
		options: [
			{ value: "0", label: "Active" },
			{ value: "-1", label: "Banned" },
			{ value: "-2", label: "Archived" },
		],
	},
	{
		key: "role",
		label: "Role",
		type: "select",
		options: [
			{ value: "0", label: "Member" },
			{ value: "1", label: "Admin" },
			{ value: "2", label: "SuperMod" },
			{ value: "3", label: "Mod" },
		],
	},
];

// ---------------------------------------------------------------------------
// Batch actions
// ---------------------------------------------------------------------------

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "ban", label: "Ban Selected", variant: "destructive" },
	{ key: "activate", label: "Activate Selected" },
];

// ---------------------------------------------------------------------------
// Status badge variant
// ---------------------------------------------------------------------------

function statusVariant(status: number): "default" | "destructive" | "secondary" | "outline" {
	switch (status) {
		case -1:
			return "destructive";
		case -2:
			return "secondary";
		default:
			return "default";
	}
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function UsersPage() {
	const [data, setData] = useState<User[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		status: "",
		role: "",
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Dialog states
	const [editUser, setEditUser] = useState<User | null>(null);
	const [editLoading, setEditLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		requireInput?: string;
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// -----------------------------------------------------------------------
	// Data fetching
	// -----------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.search) params.set("username", filters.search);
				if (filters.status) params.set("status", filters.status);
				if (filters.role) params.set("role", filters.role);

				const res = await fetch(`/api/admin/users?${params.toString()}`);
				const json = await res.json();
				setData(json.data ?? []);
				setPagination({
					page: json.meta?.page ?? page,
					pages: json.meta?.pages ?? 0,
					total: json.meta?.total ?? 0,
					limit: json.meta?.limit ?? 20,
				});
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		},
		[filters, pagination.limit],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	// -----------------------------------------------------------------------
	// Handlers
	// -----------------------------------------------------------------------

	const handlePageChange = useCallback(
		(page: number) => {
			fetchData(page);
		},
		[fetchData],
	);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "", status: "", role: "" });
	}, []);

	const handleEditSave = useCallback(
		async (id: number, update: UserUpdate) => {
			setEditLoading(true);
			try {
				await updateUser(id, update);
				setEditUser(null);
				fetchData(pagination.page);
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const handleBan = useCallback(
		(user: User, deleteContent = false) => {
			setConfirmDialog({
				open: true,
				title: deleteContent ? "Ban & Delete Content" : "Ban User",
				description: deleteContent
					? `Ban ${user.username} and delete all their content? This cannot be undone.`
					: `Ban ${user.username}? They will no longer be able to access the forum.`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await banUser(user.uid, deleteContent);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleNuke = useCallback(
		(user: User) => {
			setConfirmDialog({
				open: true,
				title: "Nuke User",
				description: `This will ban ${user.username}, delete all their content, and reset credits to 0. This cannot be undone.`,
				variant: "destructive",
				requireInput: user.username,
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await nukeUser(user.uid);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleUnban = useCallback(
		async (user: User) => {
			await updateUser(user.uid, { status: 0 });
			fetchData(pagination.page);
		},
		[fetchData, pagination.page],
	);

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;

			if (key === "ban") {
				await batchSetStatus(ids, -1);
			} else if (key === "activate") {
				await batchSetStatus(ids, 0);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	// -----------------------------------------------------------------------
	// Column definitions
	// -----------------------------------------------------------------------

	const columns: ColumnDef<User>[] = [
		{
			key: "user",
			header: "User",
			cell: (row) => (
				<div className="flex items-center gap-2">
					<div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
						{row.username[0]?.toUpperCase() ?? "?"}
					</div>
					<span className="font-medium">{row.username}</span>
				</div>
			),
		},
		{ key: "email", header: "Email", cell: (row) => row.email },
		{
			key: "role",
			header: "Role",
			cell: (row) => <Badge variant="outline">{roleLabel(row.role)}</Badge>,
		},
		{
			key: "status",
			header: "Status",
			cell: (row) => <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
		},
		{
			key: "posts",
			header: "Posts",
			cell: (row) => row.posts.toLocaleString(),
			className: "text-right",
		},
		{
			key: "registered",
			header: "Registered",
			cell: (row) => {
				const date = new Date(row.regDate);
				return date.toLocaleDateString();
			},
		},
		{
			key: "actions",
			header: "",
			cell: (row) => (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditUser(row)}>Edit</DropdownMenuItem>
						{row.status !== -1 && (
							<>
								<DropdownMenuItem onClick={() => handleBan(row)}>Ban</DropdownMenuItem>
								<DropdownMenuItem onClick={() => handleBan(row, true)} className="text-destructive">
									Ban + Delete Content
								</DropdownMenuItem>
							</>
						)}
						{row.status === -1 && (
							<DropdownMenuItem onClick={() => handleUnban(row)}>Unban</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => handleNuke(row)} className="text-destructive">
							Nuke
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
			className: "w-10",
		},
	];

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">Users</h1>
				<p className="mt-1 text-sm text-muted-foreground">Manage forum users and permissions.</p>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="rounded-xl border bg-card">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.uid}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="No users found"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			<UserEditDialog
				open={editUser !== null}
				onOpenChange={(open) => !open && setEditUser(null)}
				user={editUser}
				loading={editLoading}
				onSave={handleEditSave}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				requireInput={confirmDialog.requireInput}
				loading={confirmLoading}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
