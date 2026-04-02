"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Lightbox, type LightboxImage } from "@/components/ui/lightbox";
import { getAttachmentThumbUrl, getAttachmentUrl } from "@/lib/cdn";
import { cn } from "@/lib/utils";
import {
	type Attachment,
	batchDeleteAttachments,
	deleteAttachment,
	formatFileSize,
} from "@/viewmodels/admin/attachments";
import {
	Download,
	ExternalLink,
	FileIcon,
	Grid3X3,
	ImageIcon,
	List,
	MoreHorizontal,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "list";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索文件名...", type: "search" },
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
		<div
			className={cn(
				"group relative rounded-[var(--radius-card,14px)] bg-secondary overflow-hidden transition-all hover:shadow-md",
				selected && "ring-2 ring-primary",
			)}
		>
			{/* Selection checkbox */}
			<div className="absolute top-2 left-2 z-10">
				<Checkbox
					checked={selected}
					onCheckedChange={(checked) => onSelect(attachment.id, !!checked)}
					className="bg-background/80 backdrop-blur-sm"
				/>
			</div>

			{/* Image preview or file icon */}
			<div
				className="aspect-square bg-secondary/50 flex items-center justify-center cursor-pointer relative overflow-hidden"
				onClick={attachment.isImage ? onPreview : undefined}
				onKeyDown={
					attachment.isImage
						? (e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onPreview();
								}
							}
						: undefined
				}
				role={attachment.isImage ? "button" : undefined}
				tabIndex={attachment.isImage ? 0 : undefined}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={attachment.filename}
						className="w-full h-full object-cover transition-transform group-hover:scale-105"
						loading="lazy"
					/>
				) : (
					<FileIcon className="h-12 w-12 text-muted-foreground/50" />
				)}

				{/* Hover overlay for images */}
				{attachment.isImage && (
					<div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
						<span className="text-white text-sm font-medium">点击预览</span>
					</div>
				)}
			</div>

			{/* Info */}
			<div className="p-3 space-y-1">
				<p className="text-sm font-medium truncate" title={attachment.filename}>
					{attachment.filename}
				</p>
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>{formatFileSize(attachment.fileSize)}</span>
					<Link
						href={`/threads/${attachment.threadId}`}
						className="hover:text-primary transition-colors"
						target="_blank"
					>
						#T{attachment.threadId}
					</Link>
				</div>
			</div>

			{/* Actions */}
			<div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="secondary" size="icon" className="h-7 w-7 shadow-sm">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
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
						<DropdownMenuItem onClick={onDelete} className="text-destructive">
							<Trash2 className="h-4 w-4 mr-2" />
							删除
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// List item component
// ---------------------------------------------------------------------------

interface AttachmentListItemProps {
	attachment: Attachment;
	selected: boolean;
	onSelect: (id: number, selected: boolean) => void;
	onPreview: () => void;
	onDelete: () => void;
}

function AttachmentListItem({
	attachment,
	selected,
	onSelect,
	onPreview,
	onDelete,
}: AttachmentListItemProps) {
	const imageUrl = attachment.isImage
		? attachment.hasThumb
			? getAttachmentThumbUrl(attachment.filePath)
			: getAttachmentUrl(attachment.filePath)
		: null;

	return (
		<div
			className={cn(
				"group flex items-center gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-accent/50 transition-colors",
				selected && "bg-primary/5",
			)}
		>
			{/* Checkbox */}
			<Checkbox
				checked={selected}
				onCheckedChange={(checked) => onSelect(attachment.id, !!checked)}
			/>

			{/* Thumbnail */}
			<div
				className={cn(
					"w-14 h-14 rounded overflow-hidden bg-secondary/50 flex items-center justify-center flex-shrink-0",
					attachment.isImage && "cursor-pointer",
				)}
				onClick={attachment.isImage ? onPreview : undefined}
				onKeyDown={
					attachment.isImage
						? (e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onPreview();
								}
							}
						: undefined
				}
				role={attachment.isImage ? "button" : undefined}
				tabIndex={attachment.isImage ? 0 : undefined}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={attachment.filename}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : (
					<FileIcon className="h-6 w-6 text-muted-foreground/50" />
				)}
			</div>

			{/* Info */}
			<div className="flex-1 min-w-0">
				<p className="font-medium truncate">{attachment.filename}</p>
				<div className="flex items-center gap-4 text-sm text-muted-foreground mt-0.5">
					<span className="flex items-center gap-1">
						{attachment.isImage ? (
							<ImageIcon className="h-3.5 w-3.5" />
						) : (
							<FileIcon className="h-3.5 w-3.5" />
						)}
						{formatFileSize(attachment.fileSize)}
					</span>
					<span>{attachment.downloads} 次下载</span>
					<span>{new Date(attachment.createdAt * 1000).toLocaleDateString()}</span>
				</div>
			</div>

			{/* Thread link */}
			<Link
				href={`/threads/${attachment.threadId}`}
				className="text-sm text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
				target="_blank"
			>
				主题 #{attachment.threadId}
			</Link>

			{/* Actions */}
			<div className="flex items-center gap-1 flex-shrink-0">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={() => window.open(getAttachmentUrl(attachment.filePath), "_blank")}
				>
					<ExternalLink className="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={() => {
						const link = document.createElement("a");
						link.href = getAttachmentUrl(attachment.filePath);
						link.download = attachment.filename;
						link.click();
					}}
				>
					<Download className="h-4 w-4" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={onDelete} className="text-destructive">
							<Trash2 className="h-4 w-4 mr-2" />
							删除
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
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
				if (filters.isImage) {
					params.set("isImage", filters.isImage);
				}

				const res = await fetch(`/api/admin/attachments?${params.toString()}`);
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
			} catch {
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
		if (selectedIds.size === data.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(data.map((a) => a.id)));
		}
	}, [data, selectedIds.size]);

	const handleDelete = useCallback(
		(attachment: Attachment) => {
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
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds);
			if (ids.length === 0) return;
			if (key === "delete") {
				await batchDeleteAttachments(ids);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
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

	const lightboxImages: LightboxImage[] = data
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
		images: data.filter((a) => a.isImage).length,
		files: data.filter((a) => !a.isImage).length,
	};

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">附件管理</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						共 {stats.total} 个附件 · {stats.images} 张图片 · {stats.files} 个文件
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* View mode toggle */}
					<div className="flex items-center rounded-lg bg-secondary p-1">
						<button
							type="button"
							onClick={() => setViewMode("grid")}
							className={cn(
								"p-1.5 rounded transition-colors",
								viewMode === "grid"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							title="网格视图"
						>
							<Grid3X3 className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setViewMode("list")}
							className={cn(
								"p-1.5 rounded transition-colors",
								viewMode === "list"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							title="列表视图"
						>
							<List className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>

			{/* Filters */}
			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			{/* Content */}
			<div className="rounded-xl bg-secondary p-1 overflow-x-auto overflow-hidden">
				{/* Select all header */}
				{data.length > 0 && (
					<div className="flex items-center gap-3 px-4 py-2.5 border-b bg-secondary/30">
						<Checkbox
							checked={selectedIds.size === data.length && data.length > 0}
							onCheckedChange={handleSelectAll}
						/>
						<span className="text-sm text-muted-foreground">
							{selectedIds.size > 0 ? `已选择 ${selectedIds.size} 项` : `共 ${data.length} 项`}
						</span>
					</div>
				)}

				{/* Loading */}
				{loading && (
					<div className="flex items-center justify-center py-12">
						<div className="text-sm text-muted-foreground">加载中...</div>
					</div>
				)}

				{/* Empty state */}
				{!loading && data.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12">
						<ImageIcon className="h-10 w-10 text-muted-foreground/50" />
						<p className="mt-3 text-sm text-muted-foreground">暂无附件</p>
					</div>
				)}

				{/* Grid view */}
				{!loading && data.length > 0 && viewMode === "grid" && (
					<div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 2xl:grid-cols-[repeat(16,minmax(0,1fr))] gap-3 p-4">
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
					<div>
						{data.map((attachment) => (
							<AttachmentListItem
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

				{/* Pagination */}
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			{/* Batch action bar */}
			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			{/* Lightbox */}
			<Lightbox
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
				loading={confirmLoading}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
