"use client";

// Admin Users Page (View layer)
// MVVM: This is the View layer. State and logic are in useUsersAdmin hook.

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserAvatar } from "@/components/admin/user-avatar";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import { formatPurgeBatchSummary, useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
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
			{ value: "-99", label: "已清除" },
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

/**
 * 高级过滤器 (Batch F of task #15). Rendered in a separate section below
 * the basic filter row so the primary search/status/role surface stays
 * compact. The 5 range filters mirror the worker `range` filters
 * registered in Batch E (param naming `${key}Min` / `${key}Max`):
 *   regDate / lastLogin → daterange (00:00:00 / 23:59:59 unix seconds)
 *   threads / posts / credits → numrange
 *
 * `useUsersAdmin` -> `buildUserSearchParams` performs the unix-seconds
 * conversion + the `Number.isFinite` `0`-survival guard before the
 * request leaves the browser.
 */
const ADVANCED_FILTERS: FilterDef[] = [
	{
		key: "regDate",
		label: "注册时间",
		type: "daterange",
	},
	{
		key: "lastLogin",
		label: "最后登录",
		type: "daterange",
	},
	{
		key: "threads",
		label: "主题数",
		type: "numrange",
	},
	{
		key: "posts",
		label: "帖子数",
		type: "numrange",
	},
	{
		key: "credits",
		label: "积分",
		type: "numrange",
	},
];

// ---------------------------------------------------------------------------
// Batch actions
// ---------------------------------------------------------------------------

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "ban", label: "批量封禁", variant: "destructive" },
	{ key: "activate", label: "批量激活" },
	// Batch G of task #15. Confirm dialog requires typing `ok`; the
	// hook iterates the selection serially and surfaces a per-id
	// success/failure summary so nothing is silently dropped.
	{ key: "purge", label: "批量清除", variant: "destructive" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function UsersPage() {
	// Read initial search / IP filters from URL query params. The IP
	// filters are populated only by the user-detail page's "查询注册 IP" /
	// "查询上次登录 IP" buttons (G.6) — `AdminFilters` does not expose any
	// free-form IP input to limit PII surface. Query param names stay
	// `regIp` / `lastIp` for backward compatibility; only display copy was
	// updated in G.5.
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
		initialPageSize: 100,
		initialFilters: Object.keys(initialFilters).length > 0 ? initialFilters : undefined,
	});

	const ipBanner = state.filters.regIp
		? `正在查看注册 IP 为 ${state.filters.regIp} 的用户`
		: state.filters.lastIp
			? `正在查看上次登录 IP 为 ${state.filters.lastIp} 的用户`
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
					<UserAvatar uid={row.id} username={row.username} avatarPath={row.avatarPath} size={32} />
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
			key: "threads",
			header: "主题",
			cell: (row) => formatNumber(row.threads),
			className: "text-right tabular-nums",
		},
		{
			key: "posts",
			header: "帖子",
			cell: (row) => formatNumber(row.posts),
			className: "text-right tabular-nums",
		},
		{
			key: "messages",
			header: "站内信",
			// `messagesCount` is admin-list-only enrichment from
			// `enrichListRows` (worker handlers/admin/user.ts). Worker always
			// emits a number on the list path; the `?? 0` is belt-and-braces
			// for transient mismatches and never shows blank cells.
			cell: (row) => formatNumber(row.messagesCount ?? 0),
			className: "text-right tabular-nums",
		},
		{
			key: "attachments",
			header: "附件",
			cell: (row) => formatNumber(row.attachmentsCount ?? 0),
			className: "text-right tabular-nums",
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

			{/*
			 * 高级过滤器 — Batch F. Separated from FILTERS so the basic
			 * row stays compact. `onClearAll` is omitted here to avoid two
			 * clear buttons; `handleClearFilters` resets all filter keys
			 * (basic + advanced range) including the 10 range keys
			 * pre-declared in DEFAULT_FILTERS.
			 */}
			<details className="rounded-lg border border-border bg-secondary px-3 py-2">
				<summary className="cursor-pointer select-none text-sm font-medium text-foreground">
					高级过滤器
				</summary>
				<div className="pt-3">
					<AdminFilters
						filters={ADVANCED_FILTERS}
						values={state.filters}
						onFilterChange={actions.handleFilterChange}
					/>
				</div>
			</details>

			{ipBanner && <AdminInlineMessage variant="info" text={ipBanner} />}

			{/*
			 * Batch G — surface the most recent batch purge outcome above
			 * the table. `formatPurgeBatchSummary` always reports both
			 * counts and lists up to 3 failed-id reasons so failures are
			 * visible. Variant flips to `error` when any id failed,
			 * `success` when every id succeeded.
			 */}
			{state.purgeBatchSummary &&
				(() => {
					const text = formatPurgeBatchSummary(state.purgeBatchSummary);
					if (!text) return null;
					const variant = state.purgeBatchSummary.failed.length > 0 ? "error" : "success";
					return (
						<div className="flex items-start gap-2">
							<div className="flex-1">
								<AdminInlineMessage variant={variant} text={text} />
							</div>
							<Button variant="ghost" size="sm" onClick={actions.clearPurgeBatchSummary}>
								关闭
							</Button>
						</div>
					);
				})()}

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

			{/*
			 * Batch G — typed-confirm dialog. The selected count is read
			 * at render time (not snapshotted), so it stays accurate if
			 * the operator dismisses + reopens. Confirm token is the
			 * literal `ok` (matches the per-user purge dialog already
			 * shipped on /admin/users/[id]).
			 */}
			<AdminConfirmDialog
				open={state.purgeBatchOpen}
				onOpenChange={(open) => !open && actions.closePurgeBatchDialog()}
				title="批量彻底清除用户"
				description={`将对所选 ${state.selectedIds.size} 个用户执行不可恢复的内容清除（主题、帖子、点评、附件、私信、R2 资源）+ 留下 tombstone。该操作逐个串行执行；员工账号 (role > 0) 会被服务端拒绝。`}
				requireInput="ok"
				inputPlaceholder="ok"
				confirmLabel={`确认清除 ${state.selectedIds.size} 个`}
				variant="destructive"
				loading={state.purgeBatchLoading}
				error={state.purgeBatchError}
				onConfirm={actions.handlePurgeBatchConfirm}
			/>
		</div>
	);
}
