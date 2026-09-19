"use client";

// Admin Users Page (View layer)
// MVVM: This is the View layer. State and logic are in useUsersAdmin hook.

import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	LayerCard,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	ChevronDown,
	Eye,
	MailCheck,
	MessageSquare,
	Pencil,
	ShieldCheck,
	SlidersHorizontal,
	Users,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { buildUserColumns } from "@/components/admin/columns/user-columns";
import { UserDetailDialog } from "@/components/admin/user-detail-dialog";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { formatPurgeBatchSummary, useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import { useWritePermissionSettings } from "@/viewmodels/admin/use-write-permission-settings";
import type { User } from "@/viewmodels/admin/users";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "用户名前缀 / 邮箱 / uid:123", type: "search" },
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

	const handleDialogChanged = useCallback(() => {
		void actions.reloadCurrentPage();
	}, [actions]);

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

	// Build the shared "full" preset once per render — the caller side stays
	// thin. writeGate is auto-included because we pass both writeSettings and
	// nowSeconds; the compact users list on /admin/recent skips writeGate by
	// simply not passing these opts. Trailing actions column (Eye / Pencil)
	// stays here since its handlers close over the useUsersAdmin hook.
	const columns: ColumnDef<User>[] = [
		...buildUserColumns({
			variant: "full",
			onOpenDetail: actions.openDetail,
			writeGateSettings: writeSettings.settings,
			nowSeconds,
		}),
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
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Users aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						用户
					</span>
				}
				description="账号状态、内容贡献与访问权限"
			/>
			<AdminMetrics
				items={[
					{
						label: "筛选结果",
						value: state.loading ? "—" : state.pagination.total,
						icon: Users,
						hint: "当前条件下的全部用户",
					},
					{
						label: "本页邮箱已验证",
						value: state.loading ? "—" : state.data.filter((u) => !!u.emailVerifiedAt).length,
						icon: MailCheck,
						hint: `本页 ${state.data.length} 位用户`,
					},
					{
						label: "本页管理团队",
						value: state.loading ? "—" : state.data.filter((u) => u.role > 0).length,
						icon: ShieldCheck,
						hint: "管理员、超级版主与版主",
					},
					{
						label: "本页用户内容贡献",
						value: state.loading ? "—" : state.data.reduce((n, u) => n + (u.posts ?? 0), 0),
						icon: MessageSquare,
						hint: "帖子累计，包含主题首帖",
					},
				]}
			/>
			<LayerCard padding="sm" className="space-y-2">
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
				<Collapsible
					defaultOpen={ADVANCED_FILTERS.some((filter) =>
						Boolean(
							state.filters[filter.key] ||
								state.filters[`${filter.key}Min`] ||
								state.filters[`${filter.key}Max`],
						),
					)}
				>
					<div className="border-t border-basalt-border pt-2">
						<CollapsibleTrigger asChild>
							<Button variant="ghost" size="sm" className="group h-8 text-basalt-muted-foreground">
								<SlidersHorizontal aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
								高级过滤器
								<ChevronDown
									aria-hidden="true"
									className="ml-2 h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
								/>
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent unstyled className="pt-3">
							<AdminFilters
								filters={ADVANCED_FILTERS}
								values={state.filters}
								onFilterChange={actions.handleFilterChange}
							/>
						</CollapsibleContent>
					</div>
				</Collapsible>
			</LayerCard>

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

			<LayerCard padding="none" className="overflow-hidden">
				<AdminDataTable
					label="用户列表"
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
			</LayerCard>

			<AdminBatchBar
				selectedCount={state.selectedIds.size}
				disabled={state.statusBatchLoading || state.purgeBatchLoading}
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

			<AdminConfirmDialog
				open={state.statusBatch !== null}
				onOpenChange={(open) => !open && actions.closeStatusBatchDialog()}
				title={state.statusBatch?.status === -1 ? "批量封禁用户" : "批量激活用户"}
				description={`确定要${state.statusBatch?.status === -1 ? "封禁" : "激活"}选中的 ${state.statusBatch?.ids.length ?? 0} 个用户吗？${state.statusBatch?.status === -1 ? "封禁后这些用户将无法登录。" : "激活后这些用户将恢复正常账号状态。"}`}
				variant={state.statusBatch?.status === -1 ? "destructive" : "default"}
				loading={state.statusBatchLoading}
				error={state.statusBatchError}
				onConfirm={actions.handleStatusBatchConfirm}
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
				description={`将永久清除所选 ${state.selectedIds.size} 个用户的主题、帖子、点评、附件、私信与上传资源，并保留已清除账号记录。逐个执行并汇总结果，管理员和版主账号不能清除。`}
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
