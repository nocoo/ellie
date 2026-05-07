"use client";

// Admin Users Page (View layer)
// MVVM: This is the View layer. State and logic are in useUsersAdmin hook.

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import { useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import { type User, roleLabel, statusLabel } from "@/viewmodels/admin/users";
import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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
// Page component
// ---------------------------------------------------------------------------

export default function UsersPage() {
	// Read initial search / IP filters from URL query params. The IP
	// filters are populated only by the user-detail page's "查询注册 IP" /
	// "查询最近 IP" buttons (D3) — `AdminFilters` does not expose any
	// free-form IP input to limit PII surface.
	const searchParams = useSearchParams();
	const router = useRouter();
	const initialSearch = searchParams.get("search") ?? "";
	const initialRegIp = searchParams.get("regIp") ?? "";
	const initialLastIp = searchParams.get("lastIp") ?? "";

	const initialFilters: Partial<{
		search: string;
		regIp: string;
		lastIp: string;
	}> = {};
	if (initialSearch) initialFilters.search = initialSearch;
	if (initialRegIp) initialFilters.regIp = initialRegIp;
	if (initialLastIp) initialFilters.lastIp = initialLastIp;

	// Use ViewModel hook for all state and logic
	const { state, actions } = useUsersAdmin({
		initialFilters: Object.keys(initialFilters).length > 0 ? initialFilters : undefined,
	});

	const ipBanner = state.filters.regIp
		? `正在查看注册 IP 为 ${state.filters.regIp} 的用户`
		: state.filters.lastIp
			? `正在查看最近 IP 为 ${state.filters.lastIp} 的用户`
			: null;

	// -----------------------------------------------------------------------
	// Column definitions
	// -----------------------------------------------------------------------

	const columns: ColumnDef<User>[] = [
		{
			key: "user",
			header: "用户",
			cell: (row) => (
				<Link
					href={`/admin/users/${row.id}`}
					className="flex items-center gap-2 text-foreground hover:underline"
				>
					<div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
						{row.username[0]?.toUpperCase() ?? "?"}
					</div>
					<span className="font-medium">{row.username}</span>
				</Link>
			),
		},
		{ key: "email", header: "邮箱", cell: (row) => row.email },
		{
			key: "role",
			header: "角色",
			cell: (row) => <Badge variant={userRoleVariant(row.role)}>{roleLabel(row.role)}</Badge>,
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => (
				<Badge variant={userStatusVariant(row.status)}>{statusLabel(row.status)}</Badge>
			),
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
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={`查看用户「${row.username}」详情`}
						title={`查看用户「${row.username}」详情`}
						onClick={() => router.push(`/admin/users/${row.id}`)}
					>
						<Eye className="h-4 w-4" />
					</Button>
					{row.status !== -99 && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label={`编辑用户「${row.username}」`}
							title={`编辑用户「${row.username}」`}
							onClick={() => actions.openEditDialog(row)}
						>
							<Pencil className="h-4 w-4" />
						</Button>
					)}
				</div>
			),
			className: "w-auto whitespace-nowrap",
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

			{ipBanner && <AdminInlineMessage variant="info" text={ipBanner} />}

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
				error={state.editError}
				onSave={actions.handleEditSave}
			/>
		</div>
	);
}
