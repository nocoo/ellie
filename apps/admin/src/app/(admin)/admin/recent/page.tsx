"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { SegmentedSwitch } from "@/components/admin/segmented-switch";
import { PageHeader } from "@/components/layout/page-header";
import { extractErrorMessage } from "@/lib/admin-error";
import { getAttachmentThumbUrl, getAttachmentUrl } from "@/lib/cdn";
import type { Attachment } from "@/viewmodels/admin/attachments";
import { formatFileSize } from "@/viewmodels/admin/attachments";
import type { Post } from "@/viewmodels/admin/posts";
import {
	TAB_LABELS,
	TIME_RANGE_LABELS,
	type TabKey,
	type TimeRange,
	fetchRecentAttachments,
	fetchRecentPosts,
	fetchRecentThreads,
	fetchRecentUsers,
	timeRangeToBounds,
} from "@/viewmodels/admin/recent";
import type { Thread } from "@/viewmodels/admin/threads";
import { type User, roleLabel } from "@/viewmodels/admin/users";
import { formatDate } from "@ellie/shared";
import { Badge, Button, Lightbox, type LightboxImage } from "@ellie/ui";
import { FileIcon, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_TABS: TabKey[] = ["users", "threads", "posts", "attachments"];
const DEFAULT_TAB: TabKey = "users";
const DEFAULT_RANGE: TimeRange = "today";
const PAGE_LIMIT = 20;

const BATCH_ACTIONS: BatchAction[] = [{ key: "delete", label: "批量删除", variant: "destructive" }];

// ---------------------------------------------------------------------------
// Page wrapper (Suspense for useSearchParams if needed later)
// ---------------------------------------------------------------------------

export default function RecentPage() {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center py-20">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<RecentPageInner />
		</Suspense>
	);
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function RecentPageInner() {
	const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_RANGE);
	const [customStart, setCustomStart] = useState("");
	const [customEnd, setCustomEnd] = useState("");
	const [activeTab, setActiveTab] = useState<TabKey>(DEFAULT_TAB);

	// Tab counts (fetched cheaply with limit=1)
	const [counts, setCounts] = useState<Record<TabKey, number>>({
		users: 0,
		threads: 0,
		posts: 0,
		attachments: 0,
	});

	// Tab data + pagination (per-tab state)
	const [data, setData] = useState<unknown[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: PAGE_LIMIT,
	});
	const [loading, setLoading] = useState(true);
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Confirm dialog
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		requireInput?: string;
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);

	// Lightbox for attachments
	const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
	const [lightboxIndex, setLightboxIndex] = useState(-1);

	// Resolve bounds from current range settings
	const bounds = useMemo(() => {
		if (timeRange === "custom") {
			const min = customStart ? Math.floor(new Date(customStart).getTime() / 1000) : 0;
			const max = customEnd
				? Math.floor(new Date(`${customEnd}T23:59:59`).getTime() / 1000)
				: Math.floor(Date.now() / 1000);
			return { min, max };
		}
		return timeRangeToBounds(timeRange);
	}, [timeRange, customStart, customEnd]);

	// Track latest fetch to avoid stale state
	const fetchIdRef = useRef(0);

	// Fetch counts for all tabs on range change
	useEffect(() => {
		const { min, max } = bounds;
		Promise.all([
			fetchRecentUsers(min, max, 1, 1),
			fetchRecentThreads(min, max, 1, 1),
			fetchRecentPosts(min, max, 1, 1),
			fetchRecentAttachments(min, max, 1, 1),
		])
			.then(([u, t, p, a]) => {
				setCounts({
					users: u.meta.total,
					threads: t.meta.total,
					posts: p.meta.total,
					attachments: a.meta.total,
				});
			})
			.catch(() => {});
	}, [bounds]);

	// Fetch tab data
	const fetchTabData = useCallback(
		async (tab: TabKey, page: number) => {
			const id = ++fetchIdRef.current;
			setLoading(true);
			setSelectedIds(new Set());
			try {
				const { min, max } = bounds;
				let res: {
					data: unknown[];
					meta: { total: number; page: number; pages: number; limit: number };
				};
				switch (tab) {
					case "users":
						res = await fetchRecentUsers(min, max, page, PAGE_LIMIT);
						break;
					case "threads":
						res = await fetchRecentThreads(min, max, page, PAGE_LIMIT);
						break;
					case "posts":
						res = await fetchRecentPosts(min, max, page, PAGE_LIMIT);
						break;
					case "attachments":
						res = await fetchRecentAttachments(min, max, page, PAGE_LIMIT);
						break;
				}
				if (id !== fetchIdRef.current) return;
				setData(res.data);
				setPagination({
					page: res.meta.page,
					pages: res.meta.pages,
					total: res.meta.total,
					limit: res.meta.limit,
				});
			} catch {
				if (id !== fetchIdRef.current) return;
				setData([]);
				setPagination({ page: 1, pages: 0, total: 0, limit: PAGE_LIMIT });
			} finally {
				if (id === fetchIdRef.current) setLoading(false);
			}
		},
		[bounds],
	);

	// Refetch on tab/range change
	useEffect(() => {
		fetchTabData(activeTab, 1);
	}, [fetchTabData, activeTab]);

	const handlePageChange = useCallback(
		(page: number) => fetchTabData(activeTab, page),
		[fetchTabData, activeTab],
	);

	const handleTabChange = useCallback((tab: TabKey) => {
		setActiveTab(tab);
		setSelectedIds(new Set());
	}, []);

	// Delete handlers (thread / post / attachment)
	const handleDeleteThread = useCallback(
		(id: number, subject: string) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除主题",
				description: `删除主题「${subject}」及其所有回复？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						const { apiClient } = await import("@/lib/api-client");
						await apiClient.delete(`/api/admin/threads/${id}`);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchTabData(activeTab, pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchTabData, activeTab, pagination.page],
	);

	const handleDeletePost = useCallback(
		(id: number) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除回复",
				description: "确定删除此回复？此操作不可撤销。",
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						const { apiClient } = await import("@/lib/api-client");
						await apiClient.delete(`/api/admin/posts/${id}`);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchTabData(activeTab, pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchTabData, activeTab, pagination.page],
	);

	const handleDeleteAttachment = useCallback(
		(id: number, filename: string) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除附件",
				description: `删除附件「${filename}」？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						const { apiClient } = await import("@/lib/api-client");
						await apiClient.delete(`/api/admin/attachments/${id}`);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchTabData(activeTab, pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchTabData, activeTab, pagination.page],
	);

	// Batch delete
	const handleBatchAction = useCallback(
		(key: string) => {
			if (key !== "delete") return;
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;

			const entityLabel =
				activeTab === "threads" ? "主题" : activeTab === "posts" ? "回复" : "附件";
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: `批量删除${entityLabel}`,
				description: `将永久删除选中的 ${ids.length} 个${entityLabel}，此操作不可撤销。请输入 ok 以确认。`,
				variant: "destructive",
				requireInput: "ok",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						const { apiClient } = await import("@/lib/api-client");
						const endpoint =
							activeTab === "threads"
								? "/api/admin/threads/batch-delete"
								: activeTab === "posts"
									? "/api/admin/posts/batch-delete"
									: "/api/admin/attachments/batch-delete";
						await apiClient.post(endpoint, { ids });
						setConfirmDialog((d) => ({ ...d, open: false }));
						setSelectedIds(new Set());
						fetchTabData(activeTab, pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "批量删除失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[selectedIds, activeTab, fetchTabData, pagination.page],
	);

	// Tab options with counts
	const tabOptions = useMemo(
		() =>
			ALL_TABS.map((tab) => ({
				value: tab,
				label: `${TAB_LABELS[tab]} (${counts[tab]})`,
			})),
		[counts],
	);

	const timeRangeOptions = useMemo(
		() =>
			(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((r) => ({
				value: r,
				label: TIME_RANGE_LABELS[r],
			})),
		[],
	);

	// Determine if current tab supports selection / batch delete
	const isSelectable = activeTab !== "users";

	return (
		<div className="space-y-6">
			<PageHeader title="增量管理" subtitle={`${TIME_RANGE_LABELS[timeRange]}新增内容概览`} />

			{/* Time range selector */}
			<div className="flex flex-wrap items-center gap-4">
				<SegmentedSwitch
					value={timeRange}
					onValueChange={setTimeRange}
					options={timeRangeOptions}
					ariaLabel="选择时间范围"
				/>
				{timeRange === "custom" && (
					<div className="flex items-center gap-2">
						<input
							type="date"
							value={customStart}
							onChange={(e) => setCustomStart(e.target.value)}
							className="h-8 rounded-md border bg-background px-2 text-xs"
						/>
						<span className="text-xs text-muted-foreground">至</span>
						<input
							type="date"
							value={customEnd}
							onChange={(e) => setCustomEnd(e.target.value)}
							className="h-8 rounded-md border bg-background px-2 text-xs"
						/>
					</div>
				)}
			</div>

			{/* Tab selector */}
			<SegmentedSwitch
				value={activeTab}
				onValueChange={handleTabChange}
				options={tabOptions}
				ariaLabel="选择内容类型"
			/>

			{/* Batch bar (for non-user tabs) */}
			{isSelectable && selectedIds.size > 0 && (
				<AdminBatchBar
					selectedCount={selectedIds.size}
					actions={BATCH_ACTIONS}
					onAction={handleBatchAction}
					onClear={() => setSelectedIds(new Set())}
				/>
			)}

			{/* Tab content */}
			<div role="tabpanel">
				{activeTab === "users" && (
					<UsersTab
						data={data as User[]}
						loading={loading}
						pagination={pagination}
						onPageChange={handlePageChange}
					/>
				)}
				{activeTab === "threads" && (
					<ThreadsTab
						data={data as Thread[]}
						loading={loading}
						pagination={pagination}
						selectedIds={selectedIds}
						onSelectionChange={setSelectedIds}
						onPageChange={handlePageChange}
						onDelete={handleDeleteThread}
					/>
				)}
				{activeTab === "posts" && (
					<PostsTab
						data={data as Post[]}
						loading={loading}
						pagination={pagination}
						selectedIds={selectedIds}
						onSelectionChange={setSelectedIds}
						onPageChange={handlePageChange}
						onDelete={handleDeletePost}
					/>
				)}
				{activeTab === "attachments" && (
					<AttachmentsTab
						data={data as Attachment[]}
						loading={loading}
						pagination={pagination}
						selectedIds={selectedIds}
						onSelectionChange={setSelectedIds}
						onPageChange={handlePageChange}
						onDelete={handleDeleteAttachment}
						onPreview={(images, index) => {
							setLightboxImages(images);
							setLightboxIndex(index);
						}}
					/>
				)}
			</div>

			{/* Confirm dialog */}
			<AdminConfirmDialog
				open={confirmDialog.open}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				requireInput={confirmDialog.requireInput}
				loading={confirmLoading}
				error={confirmError}
				onConfirm={confirmDialog.onConfirm}
				onOpenChange={(open) => {
					if (!open) setConfirmDialog((d) => ({ ...d, open: false }));
				}}
			/>

			{/* Lightbox */}
			<Lightbox
				open={lightboxIndex >= 0}
				images={lightboxImages}
				initialIndex={lightboxIndex}
				onClose={() => setLightboxIndex(-1)}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------

function UsersTab({
	data,
	loading,
	pagination,
	onPageChange,
}: {
	data: User[];
	loading: boolean;
	pagination: PaginationInfo;
	onPageChange: (page: number) => void;
}) {
	const columns: ColumnDef<User>[] = useMemo(
		() => [
			{
				key: "username",
				header: "用户名",
				cell: (row) => (
					<Link
						href={`/admin/users/${row.id}`}
						className="font-medium text-primary hover:underline"
					>
						{row.username}
					</Link>
				),
			},
			{ key: "email", header: "邮箱", cell: (row) => row.email },
			{
				key: "role",
				header: "角色",
				cell: (row) => <Badge variant="secondary">{roleLabel(row.role)}</Badge>,
			},
			{
				key: "regDate",
				header: "注册时间",
				cell: (row) => formatDate(row.regDate),
			},
			{
				key: "regIp",
				header: "注册 IP",
				cell: (row) => (
					<span className="text-xs text-muted-foreground font-mono">{row.regIp || "—"}</span>
				),
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			<AdminDataTable
				columns={columns}
				data={data}
				getRowId={(row) => row.id}
				loading={loading}
				emptyMessage="该时间段内无新注册用户"
			/>
			{pagination.pages > 1 && (
				<AdminPagination pagination={pagination} onPageChange={onPageChange} />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Threads Tab
// ---------------------------------------------------------------------------

function ThreadsTab({
	data,
	loading,
	pagination,
	selectedIds,
	onSelectionChange,
	onPageChange,
	onDelete,
}: {
	data: Thread[];
	loading: boolean;
	pagination: PaginationInfo;
	selectedIds: Set<string | number>;
	onSelectionChange: (ids: Set<string | number>) => void;
	onPageChange: (page: number) => void;
	onDelete: (id: number, subject: string) => void;
}) {
	const columns: ColumnDef<Thread>[] = useMemo(
		() => [
			{
				key: "subject",
				header: "主题",
				cell: (row) => (
					<Link
						href={`/admin/threads/${row.id}`}
						className="font-medium text-primary hover:underline line-clamp-1"
					>
						{row.subject}
					</Link>
				),
			},
			{
				key: "author",
				header: "作者",
				cell: (row) => (
					<Link href={`/admin/users/${row.authorId}`} className="text-sm hover:underline">
						{row.authorName}
					</Link>
				),
			},
			{
				key: "createdAt",
				header: "创建时间",
				cell: (row) => formatDate(row.createdAt),
			},
			{
				key: "replies",
				header: "回复",
				cell: (row) => row.replies,
				className: "text-center",
			},
			{
				key: "views",
				header: "浏览",
				cell: (row) => row.views,
				className: "text-center",
			},
			{
				key: "actions",
				header: "",
				cell: (row) => (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-destructive hover:text-destructive"
						onClick={() => onDelete(row.id, row.subject)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				),
				className: "w-10",
			},
		],
		[onDelete],
	);

	return (
		<div className="space-y-4">
			<AdminDataTable
				columns={columns}
				data={data}
				getRowId={(row) => row.id}
				selectable
				selectedIds={selectedIds}
				onSelectionChange={onSelectionChange}
				loading={loading}
				emptyMessage="该时间段内无新主题"
			/>
			{pagination.pages > 1 && (
				<AdminPagination pagination={pagination} onPageChange={onPageChange} />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Posts Tab
// ---------------------------------------------------------------------------

function PostsTab({
	data,
	loading,
	pagination,
	selectedIds,
	onSelectionChange,
	onPageChange,
	onDelete,
}: {
	data: Post[];
	loading: boolean;
	pagination: PaginationInfo;
	selectedIds: Set<string | number>;
	onSelectionChange: (ids: Set<string | number>) => void;
	onPageChange: (page: number) => void;
	onDelete: (id: number) => void;
}) {
	const columns: ColumnDef<Post>[] = useMemo(
		() => [
			{
				key: "content",
				header: "内容",
				cell: (row) => (
					<span className="line-clamp-2 text-sm">
						{row.content.replace(/\[.*?\]/g, "").slice(0, 120)}
					</span>
				),
			},
			{
				key: "author",
				header: "作者",
				cell: (row) => (
					<Link
						href={`/admin/users/${row.authorId}`}
						className="text-sm hover:underline whitespace-nowrap"
					>
						{row.authorName}
					</Link>
				),
			},
			{
				key: "thread",
				header: "所在主题",
				cell: (row) => (
					<Link
						href={`/admin/threads/${row.threadId}`}
						className="text-sm text-primary hover:underline whitespace-nowrap"
					>
						#{row.threadId}
					</Link>
				),
			},
			{
				key: "createdAt",
				header: "创建时间",
				cell: (row) => formatDate(row.createdAt),
			},
			{
				key: "actions",
				header: "",
				cell: (row) =>
					!row.isFirst ? (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-destructive hover:text-destructive"
							onClick={() => onDelete(row.id)}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					) : (
						<Badge variant="secondary" className="text-xs">
							首帖
						</Badge>
					),
				className: "w-10",
			},
		],
		[onDelete],
	);

	return (
		<div className="space-y-4">
			<AdminDataTable
				columns={columns}
				data={data}
				getRowId={(row) => row.id}
				selectable
				selectedIds={selectedIds}
				onSelectionChange={onSelectionChange}
				loading={loading}
				emptyMessage="该时间段内无新回复"
			/>
			{pagination.pages > 1 && (
				<AdminPagination pagination={pagination} onPageChange={onPageChange} />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Attachments Tab
// ---------------------------------------------------------------------------

function AttachmentsTab({
	data,
	loading,
	pagination,
	selectedIds,
	onSelectionChange,
	onPageChange,
	onDelete,
	onPreview,
}: {
	data: Attachment[];
	loading: boolean;
	pagination: PaginationInfo;
	selectedIds: Set<string | number>;
	onSelectionChange: (ids: Set<string | number>) => void;
	onPageChange: (page: number) => void;
	onDelete: (id: number, filename: string) => void;
	onPreview: (images: LightboxImage[], index: number) => void;
}) {
	const handlePreview = useCallback(
		(attachment: Attachment) => {
			const images = data
				.filter((a) => a.isImage)
				.map((a) => ({
					src: getAttachmentUrl(a.filePath),
					alt: a.filename,
				}));
			const idx = images.findIndex((img) => img.alt === attachment.filename);
			if (idx >= 0) onPreview(images, idx);
		},
		[data, onPreview],
	);

	const columns: ColumnDef<Attachment>[] = useMemo(
		() => [
			{
				key: "preview",
				header: "",
				cell: (row) => {
					if (row.isImage) {
						const thumbUrl = row.hasThumb
							? getAttachmentThumbUrl(row.filePath)
							: getAttachmentUrl(row.filePath);
						return (
							<button type="button" className="block" onClick={() => handlePreview(row)}>
								<img
									src={thumbUrl}
									alt={row.filename}
									className="h-10 w-10 rounded object-cover"
									loading="lazy"
								/>
							</button>
						);
					}
					return <FileIcon className="h-6 w-6 text-muted-foreground" />;
				},
				className: "w-14",
			},
			{
				key: "filename",
				header: "文件名",
				cell: (row) => (
					<span className="text-sm truncate max-w-[200px] inline-block" title={row.filename}>
						{row.filename}
					</span>
				),
			},
			{
				key: "size",
				header: "大小",
				cell: (row) => (
					<span className="text-xs text-muted-foreground">{formatFileSize(row.fileSize)}</span>
				),
			},
			{
				key: "thread",
				header: "主题",
				cell: (row) => (
					<Link
						href={`/admin/threads/${row.threadId}`}
						className="text-sm text-primary hover:underline"
					>
						#{row.threadId}
					</Link>
				),
			},
			{
				key: "createdAt",
				header: "创建时间",
				cell: (row) => formatDate(row.createdAt),
			},
			{
				key: "actions",
				header: "",
				cell: (row) => (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-destructive hover:text-destructive"
						onClick={() => onDelete(row.id, row.filename)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				),
				className: "w-10",
			},
		],
		[onDelete, handlePreview],
	);

	return (
		<div className="space-y-4">
			<AdminDataTable
				columns={columns}
				data={data}
				getRowId={(row) => row.id}
				selectable
				selectedIds={selectedIds}
				onSelectionChange={onSelectionChange}
				loading={loading}
				emptyMessage="该时间段内无新附件"
			/>
			{pagination.pages > 1 && (
				<AdminPagination pagination={pagination} onPageChange={onPageChange} />
			)}
		</div>
	);
}
