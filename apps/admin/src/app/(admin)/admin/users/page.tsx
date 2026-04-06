"use client";

// Admin Users Page (View layer)
// MVVM: This is the View layer. State and logic are in useUsersAdmin hook.

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import { type User, roleLabel, statusLabel } from "@/viewmodels/admin/users";
import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@ellie/ui";
import { MoreHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索用户...", type: "search" },
	{
		key: "status",
		label: "状态",
		type: "select",
		options: [
			{ value: "0", label: "正常" },
			{ value: "-1", label: "已封禁" },
			{ value: "-2", label: "已归档" },
		],
	},
	{
		key: "role",
		label: "角色",
		type: "select",
		options: [
			{ value: "0", label: "会员" },
			{ value: "1", label: "管理员" },
			{ value: "2", label: "超级版主" },
			{ value: "3", label: "版主" },
		],
	},
];

// ---------------------------------------------------------------------------
// Batch actions
// ---------------------------------------------------------------------------

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "ban", label: "批量封禁", variant: "destructive" },
	{ key: "activate", label: "批量激活" },
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
	// Read initial search from URL query params
	const searchParams = useSearchParams();
	const initialSearch = searchParams.get("search") ?? "";

	// Use ViewModel hook for all state and logic
	const { state, actions } = useUsersAdmin({
		initialFilters: initialSearch ? { search: initialSearch } : undefined,
	});

	// -----------------------------------------------------------------------
	// Column definitions
	// -----------------------------------------------------------------------

	const columns: ColumnDef<User>[] = [
		{
			key: "user",
			header: "用户",
			cell: (row) => (
				<div className="flex items-center gap-2">
					<div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
						{row.username[0]?.toUpperCase() ?? "?"}
					</div>
					<span className="font-medium">{row.username}</span>
				</div>
			),
		},
		{ key: "email", header: "邮箱", cell: (row) => row.email },
		{
			key: "role",
			header: "角色",
			cell: (row) => <Badge variant="outline">{roleLabel(row.role)}</Badge>,
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
		},
		{
			key: "posts",
			header: "帖子",
			cell: (row) => formatNumber(row.posts),
			className: "text-right",
		},
		{
			key: "registered",
			header: "注册时间",
			cell: (row) => {
				const date = new Date(row.regDate * 1000);
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
						<DropdownMenuItem onClick={() => actions.openEditDialog(row)}>编辑</DropdownMenuItem>
						{row.status !== -1 && (
							<>
								<DropdownMenuItem onClick={() => actions.handleBan(row)}>封禁</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => actions.handleBan(row, true)}
									className="text-destructive"
								>
									封禁并删除内容
								</DropdownMenuItem>
							</>
						)}
						{row.status === -1 && (
							<DropdownMenuItem onClick={() => actions.handleUnban(row)}>解除封禁</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => actions.handleNuke(row)} className="text-destructive">
							彻底清除
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
				<h1 className="text-2xl font-semibold text-foreground">用户</h1>
				<p className="mt-1 text-sm text-muted-foreground">管理论坛用户及权限</p>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={state.filters}
				onFilterChange={actions.handleFilterChange}
				onClearAll={actions.handleClearFilters}
			/>

			<div className="rounded-xl bg-secondary p-1 overflow-x-auto">
				<AdminDataTable
					columns={columns}
					data={state.data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={state.selectedIds}
					onSelectionChange={actions.setSelectedIds}
					loading={state.loading}
					emptyMessage="暂无用户"
				/>
				<AdminPagination pagination={state.pagination} onPageChange={actions.handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={state.selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={actions.handleBatchAction}
				onClear={() => actions.setSelectedIds(new Set())}
			/>

			<UserEditDialog
				open={state.editUser !== null}
				onOpenChange={(open) => !open && actions.closeEditDialog()}
				user={state.editUser}
				loading={state.editLoading}
				onSave={actions.handleEditSave}
			/>

			<AdminConfirmDialog
				open={state.confirmDialog.open}
				onOpenChange={(open) => !open && actions.closeConfirmDialog()}
				title={state.confirmDialog.title}
				description={state.confirmDialog.description}
				variant={state.confirmDialog.variant}
				requireInput={state.confirmDialog.requireInput}
				loading={state.confirmLoading}
				onConfirm={state.confirmDialog.onConfirm}
			/>
		</div>
	);
}
