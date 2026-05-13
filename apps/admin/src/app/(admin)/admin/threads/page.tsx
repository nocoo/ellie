"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { ThreadBatchMoveDialog } from "@/components/admin/thread-batch-move-dialog";
import { ThreadEditDialog } from "@/components/admin/thread-edit-dialog";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
} from "@/viewmodels/admin/badges";
import { type Forum, fetchForums } from "@/viewmodels/admin/forums";
import {
	type Thread,
	type ThreadUpdate,
	batchDeleteThreads,
	batchMoveThreads,
	buildThreadsListQuery,
	deleteThread,
	digestLabel,
	emptyThreadsListFilters,
	fetchThreads,
	forumNameById,
	parseThreadsListQuery,
	stickyLabel,
	updateThread,
} from "@/viewmodels/admin/threads";
import { formatDate, formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Lock, Pencil, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------
//
// Phase H.2 added two more filters:
//   - `authorName` (search, like) — mirrors the worker `like` filter on
//     `author_name`. We use a search input because most operators only
//     remember a fragment of the username.
//   - `forumId` (select, exact) — sourced from `fetchForums()` so the
//     operator can scope the list to a single forum / sub. Groups are
//     dropped because threads cannot live in groups.

// Build the FILTERS array given the loaded forum list. `forums = []` produces
// only the static filters, so the page can render before the forum fetch
// resolves without flashing an empty select.
function buildFilters(forums: Forum[]): FilterDef[] {
	const forumOpts = forums
		.filter((f) => f.type !== "group")
		.slice()
		.sort((a, b) => {
			if (a.parentId !== b.parentId) return a.parentId - b.parentId;
			return a.displayOrder - b.displayOrder;
		})
		.map((f) => ({
			value: String(f.id),
			label: `${f.type === "sub" ? "  └ " : ""}${f.name}`,
		}));
	return [
		{ key: "search", label: "搜索主题...", type: "search" },
		{ key: "authorName", label: "作者名称...", type: "search" },
		{
			key: "forumId",
			label: "所在版块",
			type: "select",
			placeholder: "全部版块",
			options: forumOpts,
		},
		{
			key: "sticky",
			label: "置顶状态",
			type: "select",
			options: [
				{ value: "0", label: "未置顶" },
				{ value: "1", label: "版块置顶" },
				{ value: "2", label: "全局置顶" },
				{ value: "3", label: "分类置顶" },
			],
		},
		{
			key: "digest",
			label: "精华状态",
			type: "select",
			options: [
				{ value: "0", label: "非精华" },
				{ value: "1", label: "精华 I" },
				{ value: "2", label: "精华 II" },
				{ value: "3", label: "精华 III" },
			],
		},
		{
			key: "closed",
			label: "锁定状态",
			type: "select",
			options: [
				{ value: "0", label: "开放" },
				{ value: "1", label: "已锁定" },
			],
		},
		{
			key: "highlighted",
			label: "高亮状态",
			type: "select",
			options: [
				{ value: "0", label: "未高亮" },
				{ value: "1", label: "已高亮" },
			],
		},
	];
}

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "move", label: "批量移动" },
	// Batch H2 of task #15 — typed-confirm `ok` is wired below in
	// handleBatchAction so a misclick on this destructive action cannot
	// pull the trigger by itself.
	{ key: "delete", label: "批量删除", variant: "destructive" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ThreadsPage() {
	// Phase H.3.1 — initial filter state is seeded from the URL query so
	// inbound links (e.g. forum breadcrumb on the detail page →
	// `/admin/threads?forumId=5`) apply the filter on first render. We
	// read `useSearchParams()` ONCE during initial state — no useEffect
	// loop. Subsequent filter changes are written back via `router.replace`.
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const [data, setData] = useState<Thread[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 100,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>(() => ({
		...emptyThreadsListFilters(),
		...parseThreadsListQuery(searchParams),
	}));
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Phase H.2 — flat forum list, fetched once on mount. Drives both the
	// `forumId` filter dropdown and the row-level forum-name column. We
	// don't block the table on this fetch (it just renders `#<id>` until
	// the names arrive) — operators usually scan by subject, not forum.
	const [forums, setForums] = useState<Forum[]>([]);

	const [editThread, setEditThread] = useState<Thread | null>(null);
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

	const [editError, setEditError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [pageMessage, setPageMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// Batch H1 — batch-move dialog state. Local to the page (no viewmodel
	// hook for this page yet); error is in-dialog (per reviewer).
	const [moveDialogOpen, setMoveDialogOpen] = useState(false);
	const [moveLoading, setMoveLoading] = useState(false);
	const [moveError, setMoveError] = useState<string | null>(null);

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				// Phase H.2 — route through the viewmodel so filter passthrough
				// (incl. the boolean `highlighted` normalisation) is shared with
				// every other caller. The page no longer hand-rolls the
				// URLSearchParams encoding; that contract lives in
				// `buildThreadSearchParams`.
				const forumIdNum = filters.forumId ? Number(filters.forumId) : undefined;
				const stickyNum = filters.sticky ? Number(filters.sticky) : undefined;
				const digestNum = filters.digest ? Number(filters.digest) : undefined;
				const closedNum = filters.closed ? Number(filters.closed) : undefined;
				const highlightedNum: 0 | 1 | undefined =
					filters.highlighted === "1" ? 1 : filters.highlighted === "0" ? 0 : undefined;
				const res = await fetchThreads({
					page,
					limit: pagination.limit,
					subject: filters.search || undefined,
					authorName: filters.authorName || undefined,
					forumId: forumIdNum,
					sticky: stickyNum,
					digest: digestNum,
					closed: closedNum,
					highlighted: highlightedNum,
				});
				setData(res.data ?? []);
				setPagination({
					page: res.meta?.page ?? page,
					pages: res.meta?.pages ?? 0,
					total: res.meta?.total ?? 0,
					limit: res.meta?.limit ?? 100,
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

	// Forum list is independent of pagination/filter state — fetch once,
	// silently fall back to an empty list if it fails (row column will
	// show `#<id>` and the forum filter will only have the empty option).
	useEffect(() => {
		let cancelled = false;
		fetchForums()
			.then((res) => {
				if (!cancelled) setForums(res.data ?? []);
			})
			.catch(() => {
				if (!cancelled) setForums([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const filterDefs = useMemo(() => buildFilters(forums), [forums]);

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	// Phase H.3.1 — keep URL in sync with filter state. Done in the change
	// handlers (not an effect) so there is no read-from-URL → set-state →
	// write-URL cycle: the URL is purely an OUTPUT once mounted. We use
	// `router.replace` so filter changes don't bloat back-button history.
	const syncFiltersToUrl = useCallback(
		(next: Record<string, string>) => {
			const flat = buildThreadsListQuery(next);
			const qs = new URLSearchParams(flat).toString();
			router.replace(qs ? `${pathname}?${qs}` : pathname);
		},
		[router, pathname],
	);

	const handleFilterChange = useCallback(
		(key: string, value: string) => {
			setFilters((prev) => {
				const next = { ...prev, [key]: value };
				syncFiltersToUrl(next);
				return next;
			});
		},
		[syncFiltersToUrl],
	);

	const handleClearFilters = useCallback(() => {
		const next = emptyThreadsListFilters();
		setFilters(next);
		syncFiltersToUrl(next);
	}, [syncFiltersToUrl]);

	const handleEditSave = useCallback(
		async (id: number, update: ThreadUpdate) => {
			setEditLoading(true);
			setEditError(null);
			try {
				await updateThread(id, update);
				setEditThread(null);
				fetchData(pagination.page);
			} catch (err) {
				setEditError(extractErrorMessage(err, "保存主题失败"));
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const handleDelete = useCallback(
		(thread: Thread) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除主题",
				description: `删除主题「${thread.subject}」及其所有回复？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await deleteThread(thread.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除主题失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleToggleClose = useCallback(
		async (thread: Thread) => {
			setPageMessage(null);
			const next = thread.closed ? 0 : 1;
			try {
				await updateThread(thread.id, { closed: next });
				fetchData(pagination.page);
				setPageMessage({
					type: "success",
					text: next === 1 ? `已锁定「${thread.subject}」` : `已解锁「${thread.subject}」`,
				});
			} catch (err) {
				setPageMessage({
					type: "error",
					text: extractErrorMessage(err, "切换主题锁定状态失败"),
				});
			}
		},
		[fetchData, pagination.page],
	);

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;
			if (key === "delete") {
				// Batch H2 — typed-confirm `ok` (matches users-page batch
				// purge). Errors render in-dialog via confirmError.
				setConfirmError(null);
				setConfirmDialog({
					open: true,
					title: "批量删除主题",
					description: `将永久删除选中的 ${ids.length} 个主题及其全部回复，此操作不可撤销。请输入 ok 以确认。`,
					variant: "destructive",
					requireInput: "ok",
					onConfirm: async () => {
						setConfirmLoading(true);
						setConfirmError(null);
						try {
							const result = await batchDeleteThreads(ids);
							setConfirmDialog((d) => ({ ...d, open: false }));
							setSelectedIds(new Set());
							fetchData(pagination.page);
							setPageMessage({
								type: "success",
								text: `已删除 ${result.count} 个主题`,
							});
						} catch (err) {
							setConfirmError(extractErrorMessage(err, "批量删除主题失败"));
						} finally {
							setConfirmLoading(false);
						}
					},
				});
				return;
			}
			if (key === "move") {
				// Batch H1 — open the dedicated picker dialog. Selection is
				// captured via state; the dialog reads selectedIds.size at
				// render time so it always reflects the live count.
				setMoveError(null);
				setMoveDialogOpen(true);
				return;
			}
		},
		[selectedIds, fetchData, pagination.page],
	);

	const handleMoveConfirm = useCallback(
		async (forumId: number) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) {
				setMoveError("未选择任何主题");
				return;
			}
			setMoveLoading(true);
			setMoveError(null);
			try {
				const result = await batchMoveThreads(ids, forumId);
				setMoveDialogOpen(false);
				setSelectedIds(new Set());
				fetchData(pagination.page);
				setPageMessage({
					type: "success",
					text: `已移动 ${result.count} 个主题到目标版块`,
				});
			} catch (err) {
				setMoveError(extractErrorMessage(err, "批量移动主题失败"));
			} finally {
				setMoveLoading(false);
			}
		},
		[selectedIds, fetchData, pagination.page],
	);

	const columns: ColumnDef<Thread>[] = [
		{
			key: "subject",
			header: "标题",
			cell: (row) => (
				<div className="flex flex-col gap-0.5">
					<Link
						href={`/admin/threads/${row.id}`}
						className="font-medium text-foreground hover:underline"
					>
						{row.subject}
					</Link>
					{row.typeName && (
						<span className="text-xs text-muted-foreground">类型：{row.typeName}</span>
					)}
				</div>
			),
		},
		{
			key: "forum",
			header: "版块",
			cell: (row) => (
				<span className="text-sm text-muted-foreground">{forumNameById(forums, row.forumId)}</span>
			),
		},
		{
			key: "author",
			header: "作者",
			cell: (row) =>
				row.authorId > 0 ? (
					<Link href={`/admin/users/${row.authorId}`} className="text-primary hover:underline">
						{row.authorName}
					</Link>
				) : (
					row.authorName
				),
		},
		{
			key: "replies",
			header: "回复",
			cell: (row) => formatNumber(row.replies),
			className: "text-right",
		},
		{
			key: "views",
			header: "浏览",
			cell: (row) => formatNumber(row.views),
			className: "text-right",
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => (
				<div className="flex flex-wrap gap-1">
					{row.sticky > 0 && (
						<Badge variant={threadStickyVariant(row.sticky)}>{stickyLabel(row.sticky)}</Badge>
					)}
					{row.closed > 0 && <Badge variant={threadClosedVariant(row.closed)}>已锁定</Badge>}
					{row.digest > 0 && (
						<Badge variant={threadDigestVariant(row.digest)}>{digestLabel(row.digest)}</Badge>
					)}
					{row.highlight > 0 && <Badge variant={threadHighlightVariant(row.highlight)}>高亮</Badge>}
				</div>
			),
		},
		{
			key: "createdAt",
			header: "创建于",
			cell: (row) => (
				<span className="text-sm text-muted-foreground">{formatDate(row.createdAt) || "—"}</span>
			),
		},
		{
			key: "lastPost",
			header: "最后回复",
			cell: (row) => {
				if (!row.lastPostAt) return <span className="text-muted-foreground">—</span>;
				const date = formatDate(row.lastPostAt);
				// `lastPoster` is "" when the worker hasn't joined the user
				// row (e.g. user since deleted). Fall back to the date alone
				// so we never render "by " with a blank author.
				return (
					<div className="flex flex-col gap-0.5 text-sm">
						<span>{date}</span>
						{row.lastPoster && (
							<span className="text-xs text-muted-foreground">
								{row.lastPosterId > 0 ? (
									<Link href={`/admin/users/${row.lastPosterId}`} className="hover:underline">
										{row.lastPoster}
									</Link>
								) : (
									row.lastPoster
								)}
							</span>
						)}
					</div>
				);
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
						aria-label={`编辑主题「${row.subject}」`}
						title={`编辑主题「${row.subject}」`}
						onClick={() => setEditThread(row)}
					>
						<Pencil className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={row.closed ? `解锁主题「${row.subject}」` : `锁定主题「${row.subject}」`}
						title={row.closed ? `解锁主题「${row.subject}」` : `锁定主题「${row.subject}」`}
						onClick={() => handleToggleClose(row)}
					>
						{row.closed ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-destructive hover:text-destructive focus-visible:text-destructive"
						aria-label={`删除主题「${row.subject}」`}
						title={`删除主题「${row.subject}」`}
						onClick={() => handleDelete(row)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			),
			className: "w-auto whitespace-nowrap",
		},
	];

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">主题</h1>
				<p className="mt-1 text-sm text-muted-foreground">管理论坛主题</p>
			</div>

			<AdminFilters
				filters={filterDefs}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			{pageMessage && <AdminInlineMessage variant={pageMessage.type} text={pageMessage.text} />}

			<div className="rounded-xl bg-secondary p-1 overflow-x-auto">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="暂无主题"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			<ThreadEditDialog
				open={editThread !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditThread(null);
						setEditError(null);
					}
				}}
				thread={editThread}
				loading={editLoading}
				error={editError}
				onSave={handleEditSave}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => {
					setConfirmDialog((d) => ({ ...d, open }));
					if (!open) setConfirmError(null);
				}}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				requireInput={confirmDialog.requireInput}
				loading={confirmLoading}
				error={confirmError}
				onConfirm={confirmDialog.onConfirm}
			/>

			<ThreadBatchMoveDialog
				open={moveDialogOpen}
				onOpenChange={(open) => {
					setMoveDialogOpen(open);
					if (!open) setMoveError(null);
				}}
				selectedCount={selectedIds.size}
				loading={moveLoading}
				error={moveError}
				onConfirm={handleMoveConfirm}
			/>
		</div>
	);
}
