"use client";

// Admin Users Page (View layer)
// MVVM: This is the View layer. State and logic are in useUsersAdmin hook.

import { formatNumber } from "@ellie/shared";
import { Badge, Button } from "@ellie/ui";
import { Eye, Pencil } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserAvatar } from "@/components/admin/user-avatar";
import { UserDetailDialog } from "@/components/admin/user-detail-dialog";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { UserWriteGateBadges } from "@/components/admin/user-write-gate-badges";
import { PageHeader } from "@/components/layout/page-header";
import { userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import { formatPurgeBatchSummary, useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import { useWritePermissionSettings } from "@/viewmodels/admin/use-write-permission-settings";
import { roleLabel, statusLabel, type User } from "@/viewmodels/admin/users";

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
 * 高级过滤器 (Batch F of task #15 + IP search from task #9 Phase A).
 * Rendered in a separate section below the basic filter row so the
 * primary search/status/role surface stays compact. The 5 range filters
 * mirror the worker `range` filters registered in Batch E (param naming
 * `${key}Min` / `${key}Max`):
 *   regDate / lastLogin → daterange (00:00:00 / 23:59:59 unix seconds)
 *   threads / posts / credits → numrange
 *
 * `useUsersAdmin` -> `buildUserSearchParams` performs the unix-seconds
 * conversion + the `Number.isFinite` `0`-survival guard before the
 * request leaves the browser.
 */
const ADVANCED_FILTERS: FilterDef[] = [
	// IP search (task #9 Phase A). `regIp` / `lastIp` map to worker
	// `users.reg_ip` / `users.last_ip` exact-match filters (apps/worker/
	// src/handlers/admin/user.ts L112-137). Two independent fields, not a
	// combined "IP" input, because the worker treats them as distinct
	// columns. Inputs reuse the existing `type: "search"` filter
	// (submit-on-Enter + inline clear `<X>`); per-key local input state
	// in AdminFilters (H.2.1) keeps the two boxes from sharing a buffer.
	// IPv6 fits the 200px input (longest 39 chars); the worker contract
	// is exact-match so the operator must type the full address.
	{
		key: "regIp",
		label: "注册 IP",
		type: "search",
	},
	{
		key: "lastIp",
		label: "上次登录 IP",
		type: "search",
	},
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
	// Write-gate visibility filters — mirror the worker `positive` / `expr`
	// user filters wired in apps/worker/src/handlers/admin/user.ts. Two
	// discrete "yes / no" selects rather than a segmented switch so they
	// stay consistent with the existing status / role select controls and
	// clear to the same empty-string sentinel via handleClearFilters.
	{
		key: "emailVerified",
		label: "邮箱验证",
		type: "select",
		options: [
			{ value: "true", label: "已验证" },
			{ value: "false", label: "未验证" },
		],
	},
	{
		key: "hasAvatar",
		label: "有头像",
		type: "select",
		options: [
			{ value: "true", label: "是" },
			{ value: "false", label: "否" },
		],
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
	// filter inputs are now exposed in the 高级过滤器 panel (task #9
	// Phase A), so `regIp` / `lastIp` query keys serve two purposes:
	// (1) deep-link / bookmark restore, (2) the `<UserDetailDialog>`'s
	// `onSearchIp` callback can update them in-place without route
	// changes. Query param names match the worker `users.reg_ip` /
	// `users.last_ip` exact-match filter contract.
	const searchParams = useSearchParams();
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
	// Detail dialog wiring (task #9 Phase C)
	// -----------------------------------------------------------------------

	// Reset both IP filters before applying the new one so switching
	// from `regIp` to `lastIp` (or vice versa) does not leave both set
	// (worker would AND them and find nothing). Then close the dialog
	// so the operator lands on the freshly filtered list rather than
	// re-reading the same user.
	const handleDialogSearchIp = useCallback(
		(kind: "regIp" | "lastIp", ip: string) => {
			actions.handleFilterChange("regIp", "");
			actions.handleFilterChange("lastIp", "");
			actions.handleFilterChange(kind, ip);
			actions.closeDetail();
		},
		[actions],
	);

	// Refresh the current page after any mutation inside the dialog so
	// row badges (status / role / counts) reflect reality once the
	// dialog closes. Purge also closes the dialog — the user is
	// tombstoned and is about to drop off the list on reload anyway.
	const handleDialogChanged = useCallback(
		(event: { kind: "edit" | "ban" | "unban" | "purge"; userId: number }) => {
			void actions.reloadCurrentPage();
			if (event.kind === "purge") {
				actions.closeDetail();
			}
		},
		[actions],
	);

	// Site-level posting settings feed the "写权限" column below. Fetched
	// once per page mount (shared with UserDetailPanel via the same hook)
	// and cached in state; on failure the hook falls back to defaults so
	// the badges keep rendering rather than blocking the whole table.
	const writeSettings = useWritePermissionSettings();
	// Snapshot "now" once per render so every row uses the same day
	// boundary. useMemo would over-cache across data refreshes; recomputing
	// on every render is negligible.
	const nowSeconds = Math.floor(Date.now() / 1000);

	// -----------------------------------------------------------------------
	// Column definitions
	// -----------------------------------------------------------------------

	const columns: ColumnDef<User>[] = [
		{
			key: "user",
			header: "用户",
			cell: (row) => (
				<button
					type="button"
					onClick={() => actions.openDetail(row.id)}
					className="flex items-center gap-2 text-foreground hover:underline"
				>
					<UserAvatar uid={row.id} username={row.username} avatarPath={row.avatarPath} size={32} />
					<span className="font-medium">{row.username}</span>
				</button>
			),
		},
		{
			key: "email",
			header: "邮箱",
			cell: (row) => (
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="break-all">{row.email || "—"}</span>
					{/*
					 * emailVerifiedAt is 0 for unverified accounts (docs/17 §3).
					 * We only badge active users (status === 0) — banned /
					 * archived / tombstone rows already surface their state in
					 * the 状态 column and would clutter here. Rows without an
					 * email string at all still get the badge because "no
					 * address" is even weaker than "unverified".
					 */}
					{row.status === 0 && !row.emailVerifiedAt && <Badge variant="destructive">未验证</Badge>}
				</div>
			),
		},
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
			key: "writeGate",
			header: "写权限",
			cell: (row) => (
				<UserWriteGateBadges user={row} settings={writeSettings.settings} nowSeconds={nowSeconds} />
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
						onClick={() => actions.openDetail(row.id)}
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
		<div className="space-y-6 md:space-y-8">
			<PageHeader title="用户" subtitle="管理论坛用户及权限" />

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
			 * Task #9 Phase C — user detail mounted in a wide dialog so the
			 * list page's pagination / filter / selection state survives
			 * open/close. Standalone `/admin/users/[id]` route is preserved
			 * as a deep-link fallback (no behaviour change there).
			 */}
			<UserDetailDialog
				userId={state.detailUserId}
				onClose={actions.closeDetail}
				onSearchIp={handleDialogSearchIp}
				onChanged={handleDialogChanged}
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
