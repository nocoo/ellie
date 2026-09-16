"use client";

import {
	Button,
	Checkbox,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	LayerCard,
	SegmentControl,
} from "@nocoo/basalt";
import { Empty } from "@nocoo/basalt/components/empty";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Download,
	ExternalLink,
	FileIcon,
	Grid3X3,
	HardDrive,
	ImageIcon,
	List,
	MoreHorizontal,
	Paperclip,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { twMerge as cn } from "tailwind-merge";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import {
	AttachmentLightbox,
	type AttachmentPreviewImage,
} from "@/components/admin/attachment-lightbox";
import { buildAttachmentColumns } from "@/components/admin/columns/attachment-columns";
import { extractErrorMessage } from "@/lib/admin-error";
import { getAttachmentThumbUrl, getAttachmentUrl } from "@/lib/cdn";
import {
	type Attachment,
	batchDeleteAttachments,
	deleteAttachment,
	formatFileSize,
} from "@/viewmodels/admin/attachments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "list";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索本页文件名...", type: "search" },
	{
		key: "isImage",
		label: "类型",
		type: "select",
		options: [
			{ value: "1", label: "图片" },
			{ value: "0", label: "其他文件" },
		],
	},
];

const BATCH_ACTIONS: BatchAction[] = [{ key: "delete", label: "批量删除", variant: "destructive" }];

// ---------------------------------------------------------------------------
// Grid item component
// ---------------------------------------------------------------------------

interface AttachmentGridItemProps {
	attachment: Attachment;
	selected: boolean;
	onSelect: (id: number, selected: boolean) => void;
	onPreview: () => void;
	onDelete: () => void;
}

function AttachmentGridItem({
	attachment,
	selected,
	onSelect,
	onPreview,
	onDelete,
}: AttachmentGridItemProps) {
	const imageUrl = attachment.isImage
		? attachment.hasThumb
			? getAttachmentThumbUrl(attachment.filePath)
			: getAttachmentUrl(attachment.filePath)
		: null;

	return (
		<LayerCard
			padding="none"
			className={cn(
				"group relative overflow-hidden transition-all",
				selected && "ring-2 ring-basalt-primary",
			)}
		>
			{/* Selection checkbox */}
			<div className="absolute top-2 left-2 z-10">
				<Checkbox
					checked={selected}
					aria-label={`选择附件 ${attachment.filename}`}
					onCheckedChange={(checked) => onSelect(attachment.id, !!checked)}
				/>
			</div>

			{imageUrl ? (
				<Button
					variant="ghost"
					className="relative aspect-[4/3] h-auto w-full overflow-hidden rounded-none p-0"
					aria-label={`预览 ${attachment.filename}`}
					onClick={onPreview}
				>
					<img
						src={imageUrl}
						alt={attachment.filename}
						className="h-full w-full object-cover transition-transform group-hover:scale-105"
						loading="lazy"
					/>
					<span className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
						点击预览
					</span>
				</Button>
			) : (
				<div className="flex aspect-[4/3] items-center justify-center">
					<FileIcon className="h-12 w-12 text-basalt-muted-foreground" />
				</div>
			)}

			{/* Info */}
			<div className="p-2.5 space-y-1.5">
				<p className="text-sm font-medium truncate" title={attachment.filename}>
					{attachment.filename}
				</p>
				<div className="flex items-center justify-between text-xs text-basalt-muted-foreground">
					<span>{formatFileSize(attachment.fileSize)}</span>
					<Link
						href={`/admin/threads/${attachment.threadId}`}
						className="hover:text-basalt-primary transition-colors"
						target="_blank"
					>
						#T{attachment.threadId}
					</Link>
				</div>
				<div className="flex items-center justify-between gap-2 text-[11px] text-basalt-muted-foreground">
					<span className="flex items-center gap-1">
						<Download aria-hidden="true" className="h-3 w-3" />
						{attachment.downloads ?? 0}
					</span>
					<span>{new Date(attachment.createdAt * 1000).toLocaleDateString()}</span>
				</div>
			</div>

			{/* Actions */}
			<div className="absolute top-2 right-2 z-10 opacity-100 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="secondary"
							size="icon"
							className="h-7 w-7"
							aria-label={`打开「${attachment.filename}」操作菜单`}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onClick={() => window.open(getAttachmentUrl(attachment.filePath), "_blank")}
						>
							<ExternalLink className="h-4 w-4 mr-2" />
							打开
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								const link = document.createElement("a");
								link.href = getAttachmentUrl(attachment.filePath);
								link.download = attachment.filename;
								link.click();
							}}
						>
							<Download className="h-4 w-4 mr-2" />
							下载
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onDelete} className="text-basalt-destructive">
							<Trash2 className="h-4 w-4 mr-2" />
							删除
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</LayerCard>
	);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AttachmentsPage() {
	const [data, setData] = useState<Attachment[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 100,
	});
	const [loading, setLoading] = useState(true);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [viewMode, setViewMode] = useState<ViewMode>("grid");
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		isImage: "",
	});

	// Lightbox state
	const [lightboxOpen, setLightboxOpen] = useState(false);
	const [lightboxIndex, setLightboxIndex] = useState(0);

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
	const [loadError, setLoadError] = useState<string | null>(null);

	// -----------------------------------------------------------------------
	// Data fetching
	// -----------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			setLoadError(null);
			setSelectedIds(new Set());
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.isImage) {
					params.set("isImage", filters.isImage);
				}

				const res = await fetch(`/api/admin/attachments?${params.toString()}`);
				if (!res.ok) throw new Error("附件加载失败，请稍后重试");
				const json = await res.json();
				let items: Attachment[] = json.data ?? [];

				// Client-side search filter
				if (filters.search) {
					const q = filters.search.toLowerCase();
					items = items.filter((a) => a.filename.toLowerCase().includes(q));
				}

				setData(items);
				setPagination({
					page: json.meta?.page ?? page,
					pages: json.meta?.pages ?? 0,
					total: json.meta?.total ?? 0,
					limit: json.meta?.limit ?? 24,
				});
			} catch (err) {
				setLoadError(extractErrorMessage(err, "附件加载失败"));
				setData([]);
			} finally {
				setLoading(false);
			}
		},
		[pagination.limit, filters.isImage, filters.search],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	// -----------------------------------------------------------------------
	// Handlers
	// -----------------------------------------------------------------------

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "", isImage: "" });
	}, []);

	const handleSelect = useCallback((id: number, selected: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (selected) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}, []);

	const handleSelectAll = useCallback(() => {
		if (data.length > 0 && data.every((a) => selectedIds.has(a.id))) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(data.map((a) => a.id)));
		}
	}, [data, selectedIds]);

	const handleDelete = useCallback(
		(attachment: Attachment) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除附件",
				description: `确定删除「${attachment.filename}」？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deleteAttachment(attachment.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除附件失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleBatchAction = useCallback(
		(key: string) => {
			const ids = Array.from(selectedIds);
			if (key !== "delete" || ids.length === 0) return;
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "批量删除附件",
				description: `将永久删除选中的 ${ids.length} 个附件。请输入 ok 以确认。`,
				variant: "destructive",
				requireInput: "ok",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await batchDeleteAttachments(ids);
						setConfirmDialog((d) => ({ ...d, open: false }));
						setSelectedIds(new Set());
						fetchData(pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "批量删除附件失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[selectedIds, fetchData, pagination.page],
	);

	const handlePreview = useCallback(
		(attachment: Attachment) => {
			// Find index among image attachments
			const imageAttachments = data.filter((a) => a.isImage);
			const index = imageAttachments.findIndex((a) => a.id === attachment.id);
			if (index >= 0) {
				setLightboxIndex(index);
				setLightboxOpen(true);
			}
		},
		[data],
	);

	// -----------------------------------------------------------------------
	// Lightbox images
	// -----------------------------------------------------------------------

	const lightboxImages: AttachmentPreviewImage[] = data
		.filter((a) => a.isImage)
		.map((a) => ({
			src: getAttachmentUrl(a.filePath),
			alt: a.filename,
			title: a.filename,
		}));

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	const stats = {
		total: pagination.total,
		bytes: data.reduce((n, a) => n + a.fileSize, 0),
		downloads: data.reduce((n, a) => n + (a.downloads ?? 0), 0),
		images: data.filter((a) => a.isImage).length,
		files: data.filter((a) => !a.isImage).length,
	};

	const columns: ColumnDef<Attachment>[] = [
		...buildAttachmentColumns({ onPreview: handlePreview }),
		{
			key: "actions",
			header: "操作",
			className: "w-auto text-right",
			cell: (row) => (
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={`打开 ${row.filename}`}
						onClick={() =>
							window.open(getAttachmentUrl(row.filePath), "_blank", "noopener,noreferrer")
						}
					>
						<ExternalLink className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={`下载 ${row.filename}`}
						onClick={() => {
							const link = document.createElement("a");
							link.href = getAttachmentUrl(row.filePath);
							link.download = row.filename;
							link.click();
						}}
					>
						<Download className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-basalt-destructive"
						aria-label={`删除 ${row.filename}`}
						onClick={() => handleDelete(row)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			),
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
						<Paperclip aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						附件管理
					</span>
				}
				description="图片与文件资源、存储体积和下载使用情况"
				actions={
					<SegmentControl
						legend="视图"
						className="[&>legend]:sr-only"
						value={viewMode}
						onValueChange={(value) => setViewMode(value as "grid" | "list")}
						options={[
							{
								value: "grid",
								label: (
									<>
										<Grid3X3 className="h-4 w-4" />
										<span className="sr-only">网格视图</span>
									</>
								),
							},
							{
								value: "list",
								label: (
									<>
										<List className="h-4 w-4" />
										<span className="sr-only">列表视图</span>
									</>
								),
							},
						]}
					/>
				}
			/>

			<AdminMetrics
				items={[
					{
						label: "类型筛选结果",
						value: loading || loadError ? "—" : stats.total,
						icon: Paperclip,
						hint: "全部页 · 文件名仅筛选本页",
					},
					{
						label: "本页图片 / 文件",
						value: loading || loadError ? "—" : `${stats.images} / ${stats.files}`,
						icon: ImageIcon,
						hint: `本页显示 ${data.length} 个附件`,
					},
					{
						label: "本页存储体积",
						value: loading || loadError ? "—" : formatFileSize(stats.bytes),
						icon: HardDrive,
						hint: "显示的附件原文件大小之和",
					},
					{
						label: "本页累计下载",
						value: loading || loadError ? "—" : stats.downloads,
						icon: Download,
						hint: "显示的附件下载次数之和",
					},
				]}
			/>
			{loadError && <AdminInlineMessage variant="error" text={loadError} />}
			{/* Filters */}
			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			{/* Content */}
			<LayerCard padding="none" className="overflow-hidden">
				{/* Select all header */}
				{!loading && viewMode === "grid" && data.length > 0 && (
					<LayerCard.Header className="items-center justify-start gap-3">
						<Checkbox
							aria-label="全选附件"
							checked={
								data.every((a) => selectedIds.has(a.id))
									? true
									: selectedIds.size > 0
										? "indeterminate"
										: false
							}
							onCheckedChange={handleSelectAll}
						/>
						<span className="text-sm text-basalt-muted-foreground">
							{selectedIds.size > 0 ? `已选择 ${selectedIds.size} 项` : `共 ${data.length} 项`}
						</span>
					</LayerCard.Header>
				)}
				<LayerCard.Well className="overflow-x-auto p-0">
					{/* Loading */}
					{loading && (
						<div role="status" className="flex items-center justify-center gap-2 py-12">
							<Loader size={16} />
							<span className="text-sm text-basalt-muted-foreground">加载中...</span>
						</div>
					)}

					{/* Empty state */}
					{!loading && data.length === 0 && (
						<Empty title="暂无附件" icon={<ImageIcon aria-hidden="true" />} className="py-12" />
					)}

					{/* Grid view */}
					{!loading && data.length > 0 && viewMode === "grid" && (
						<div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
							{data.map((attachment) => (
								<AttachmentGridItem
									key={attachment.id}
									attachment={attachment}
									selected={selectedIds.has(attachment.id)}
									onSelect={handleSelect}
									onPreview={() => handlePreview(attachment)}
									onDelete={() => handleDelete(attachment)}
								/>
							))}
						</div>
					)}

					{/* List view */}
					{!loading && data.length > 0 && viewMode === "list" && (
						<AdminDataTable
							label="附件列表"
							columns={columns}
							data={data}
							getRowId={(a) => a.id}
							selectable
							selectedIds={selectedIds}
							onSelectionChange={(ids) => setSelectedIds(new Set(Array.from(ids, Number)))}
						/>
					)}

					{/* Pagination */}
				</LayerCard.Well>
				<LayerCard.Footer>
					<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
				</LayerCard.Footer>
			</LayerCard>

			{/* Batch action bar */}
			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			{/* Lightbox */}
			<AttachmentLightbox
				images={lightboxImages}
				initialIndex={lightboxIndex}
				open={lightboxOpen}
				onClose={() => setLightboxOpen(false)}
			/>

			{/* Confirm dialog */}
			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				requireInput={confirmDialog.requireInput}
				error={confirmError}
				loading={confirmLoading}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
