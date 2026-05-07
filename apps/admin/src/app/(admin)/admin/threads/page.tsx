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
import {
	type Thread,
	type ThreadUpdate,
	batchDeleteThreads,
	batchMoveThreads,
	deleteThread,
	digestLabel,
	stickyLabel,
	updateThread,
} from "@/viewmodels/admin/threads";
import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Lock, Pencil, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索主题...", type: "search" },
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
	const [data, setData] = useState<Thread[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 100,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		sticky: "",
		digest: "",
		closed: "",
		highlighted: "",
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

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
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.search) params.set("subject", filters.search);
				if (filters.sticky) params.set("sticky", filters.sticky);
				if (filters.digest) params.set("digest", filters.digest);
				if (filters.closed) params.set("closed", filters.closed);
				if (filters.highlighted) params.set("highlighted", filters.highlighted);

				const res = await fetch(`/api/admin/threads?${params.toString()}`);
				const json = await res.json();
				setData(json.data ?? []);
				setPagination({
					page: json.meta?.page ?? page,
					pages: json.meta?.pages ?? 0,
					total: json.meta?.total ?? 0,
					limit: json.meta?.limit ?? 100,
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

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "", sticky: "", digest: "", closed: "", highlighted: "" });
	}, []);

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
								text: `已删除 ${result.affected} 个主题`,
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
					text: `已移动 ${result.affected} 个主题到目标版块`,
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
				<Link
					href={`/admin/threads/${row.id}`}
					className="font-medium text-foreground hover:underline"
				>
					{row.subject}
				</Link>
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
				<div className="flex gap-1">
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
			key: "lastPost",
			header: "最后回复",
			cell: (row) => (row.lastPostAt ? new Date(row.lastPostAt * 1000).toLocaleDateString() : "—"),
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
				filters={FILTERS}
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
