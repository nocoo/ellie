"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { ForumCreateDialog } from "@/components/admin/forum-create-dialog";
import { ForumEditDialog } from "@/components/admin/forum-edit-dialog";
import { ForumMergeDialog } from "@/components/admin/forum-merge-dialog";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	type Forum,
	type ForumCreate,
	type ForumTreeNode,
	type ForumUpdate,
	buildForumTree,
	createForum,
	deleteForum,
	fetchForums,
	flattenForumTree,
	mergeForums,
	statusLabel,
	typeLabel,
	updateForum,
} from "@/viewmodels/admin/forums";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ellie/ui";
import { cn } from "@ellie/ui/utils";
import {
	ChevronRight,
	FolderOpen,
	GitBranch,
	Layers,
	MoreHorizontal,
	Plus,
	SquareStack,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索版块...", type: "search" },
	{
		key: "status",
		label: "状态",
		type: "select",
		options: [
			{ value: "1", label: "正常" },
			{ value: "0", label: "隐藏" },
		],
	},
	{
		key: "type",
		label: "类型",
		type: "select",
		options: [
			{ value: "group", label: "分区" },
			{ value: "forum", label: "版块" },
			{ value: "sub", label: "子版块" },
		],
	},
];

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: number }) {
	return (
		<Badge variant={status === 0 ? "secondary" : "default"} className="text-[10px]">
			{statusLabel(status)}
		</Badge>
	);
}

function TypeIcon({ type }: { type: string }) {
	switch (type) {
		case "group":
			return <Layers className="h-4 w-4 text-amber-500" />;
		case "forum":
			return <FolderOpen className="h-4 w-4 text-blue-500" />;
		case "sub":
			return <GitBranch className="h-4 w-4 text-emerald-500" />;
		default:
			return <SquareStack className="h-4 w-4 text-muted-foreground" />;
	}
}

function TreeConnector({ depth, isLast }: { depth: number; isLast: boolean }) {
	if (depth === 0) return null;

	return (
		<div className="flex items-center" style={{ width: `${depth * 24}px` }}>
			{Array.from({ length: depth }).map((_, i) => (
				<div key={`connector-${depth}-${i}`} className="relative h-full w-6 flex-shrink-0">
					{i === depth - 1 ? (
						// Last connector with branch line
						<div className="absolute left-3 top-0 h-full">
							<div className={cn("absolute left-0 w-px bg-border", isLast ? "h-1/2" : "h-full")} />
							<div className="absolute left-0 top-1/2 h-px w-3 bg-border" />
						</div>
					) : (
						// Vertical line for ancestor levels
						<div className="absolute left-3 top-0 h-full w-px bg-border" />
					)}
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Forum row component
// ---------------------------------------------------------------------------

interface ForumRowProps {
	node: ForumTreeNode;
	isLast: boolean;
	onEdit: (forum: Forum) => void;
	onToggleStatus: (forum: Forum) => void;
	onMerge: (forum: Forum) => void;
	onDelete: (forum: Forum) => void;
}

function ForumRow({ node, isLast, onEdit, onToggleStatus, onMerge, onDelete }: ForumRowProps) {
	const hasChildren = node.children.length > 0;

	return (
		<div
			className={cn(
				"group flex items-center gap-3 border-b border-border/50 px-4 py-3 transition-colors hover:bg-accent/50",
				node.depth === 0 && "bg-secondary/30",
				node.status === 0 && "opacity-60",
			)}
		>
			{/* Tree connector */}
			<TreeConnector depth={node.depth} isLast={isLast} />

			{/* Type icon */}
			<div className="flex-shrink-0">
				<TypeIcon type={node.type} />
			</div>

			{/* Expand indicator for groups */}
			{node.depth === 0 && hasChildren && (
				<ChevronRight className="h-4 w-4 text-muted-foreground rotate-90" />
			)}

			{/* Forum info */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium text-foreground truncate">{node.name}</span>
					<Badge variant="outline" className="text-[10px] font-normal">
						{typeLabel(node.type)}
					</Badge>
					<StatusBadge status={node.status} />
				</div>
				{node.description && (
					<p className="mt-0.5 text-xs text-muted-foreground truncate">{node.description}</p>
				)}
			</div>

			{/* Stats */}
			<div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground">
				<div className="text-right">
					<div className="font-medium text-foreground">{node.threads.toLocaleString()}</div>
					<div>主题</div>
				</div>
				<div className="text-right">
					<div className="font-medium text-foreground">{node.posts.toLocaleString()}</div>
					<div>帖子</div>
				</div>
				<div className="w-12 text-right">
					<div className="text-foreground">{node.displayOrder}</div>
					<div>排序</div>
				</div>
			</div>

			{/* Actions */}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							aria-label={`打开「${node.name}」操作菜单`}
							className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => onEdit(node)}>编辑</DropdownMenuItem>
					<DropdownMenuItem onClick={() => onToggleStatus(node)}>
						{node.status === 1 ? "隐藏" : "显示"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => onMerge(node)}>合并到...</DropdownMenuItem>
					{node.threads === 0 && node.children.length === 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => onDelete(node)} className="text-destructive">
								删除
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ForumsPage() {
	const [rawData, setRawData] = useState<Forum[]>([]);
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		status: "",
		type: "",
	});

	// Dialog states
	const [createOpen, setCreateOpen] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
	const [editForum, setEditForum] = useState<Forum | null>(null);
	const [editLoading, setEditLoading] = useState(false);
	const [mergeSource, setMergeSource] = useState<Forum | null>(null);
	const [mergeLoading, setMergeLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// Per-dialog inline error messages (cleared on dialog close / next attempt).
	const [createError, setCreateError] = useState<string | null>(null);
	const [editError, setEditError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [mergeError, setMergeError] = useState<string | null>(null);
	// Page-level banner for actions that don't open a dialog (e.g. visibility toggle).
	const [pageMessage, setPageMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// -----------------------------------------------------------------------
	// Data fetching
	// -----------------------------------------------------------------------

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const result = await fetchForums();
			setRawData(result.data);
		} catch {
			setRawData([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// -----------------------------------------------------------------------
	// Filtered & tree data
	// -----------------------------------------------------------------------

	const filteredData = rawData.filter((f) => {
		if (filters.search) {
			const q = filters.search.toLowerCase();
			if (!f.name.toLowerCase().includes(q) && !f.description.toLowerCase().includes(q)) {
				return false;
			}
		}
		if (filters.status && f.status !== Number(filters.status)) {
			return false;
		}
		if (filters.type && f.type !== filters.type) {
			return false;
		}
		return true;
	});

	const tree = buildForumTree(filteredData);
	const flatList = flattenForumTree(tree);

	// Track last item at each depth level for connector rendering
	const isLastAtDepth = (index: number, depth: number): boolean => {
		for (let i = index + 1; i < flatList.length; i++) {
			if (flatList[i].depth < depth) return true;
			if (flatList[i].depth === depth) return false;
		}
		return true;
	};

	// -----------------------------------------------------------------------
	// Handlers
	// -----------------------------------------------------------------------

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "", status: "", type: "" });
	}, []);

	const handleCreate = useCallback(
		async (formData: ForumCreate) => {
			setCreateLoading(true);
			setCreateError(null);
			try {
				await createForum(formData);
				setCreateOpen(false);
				fetchData();
			} catch (err) {
				setCreateError(extractErrorMessage(err, "创建版块失败"));
			} finally {
				setCreateLoading(false);
			}
		},
		[fetchData],
	);

	const handleEdit = useCallback(
		async (id: number, data: ForumUpdate) => {
			setEditLoading(true);
			setEditError(null);
			try {
				await updateForum(id, data);
				setEditForum(null);
				fetchData();
			} catch (err) {
				setEditError(extractErrorMessage(err, "保存版块失败"));
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData],
	);

	const handleToggleStatus = useCallback(
		async (forum: Forum) => {
			setPageMessage(null);
			const next = forum.status === 1 ? 0 : 1;
			try {
				await updateForum(forum.id, { status: next });
				fetchData();
				setPageMessage({
					type: "success",
					text: next === 0 ? `已隐藏「${forum.name}」` : `已显示「${forum.name}」`,
				});
			} catch (err) {
				setPageMessage({
					type: "error",
					text: extractErrorMessage(err, "切换版块状态失败"),
				});
			}
		},
		[fetchData],
	);

	const handleDelete = useCallback(
		(forum: Forum) => {
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除版块",
				description: `确定删除「${forum.name}」？该操作不可恢复。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await deleteForum(forum.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData();
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除版块失败"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData],
	);

	const handleMerge = useCallback(
		async (sourceId: number, targetId: number) => {
			setMergeLoading(true);
			setMergeError(null);
			try {
				await mergeForums(sourceId, targetId);
				setMergeSource(null);
				fetchData();
				setPageMessage({ type: "success", text: "版块已合并" });
			} catch (err) {
				setMergeError(extractErrorMessage(err, "合并版块失败"));
			} finally {
				setMergeLoading(false);
			}
		},
		[fetchData],
	);

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	// Stats
	const stats = {
		groups: rawData.filter((f) => f.type === "group").length,
		forums: rawData.filter((f) => f.type === "forum").length,
		subs: rawData.filter((f) => f.type === "sub").length,
	};

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">版块管理</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{stats.groups} 个分区 · {stats.forums} 个版块 · {stats.subs} 个子版块
					</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					创建版块
				</Button>
			</div>

			{/* Filters */}
			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			{/* Page-level feedback (visibility toggle / merge) */}
			{pageMessage && <AdminInlineMessage variant={pageMessage.type} text={pageMessage.text} />}

			{/* Tree view */}
			<div className="rounded-xl bg-secondary p-1 overflow-x-auto overflow-hidden">
				{/* Table header */}
				<div className="flex items-center gap-3 border-b bg-secondary/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
					<div className="flex-1">版块</div>
					<div className="hidden sm:flex items-center gap-6">
						<div className="w-16 text-right">主题</div>
						<div className="w-16 text-right">帖子</div>
						<div className="w-12 text-right">排序</div>
					</div>
					<div className="w-8" />
				</div>

				{/* Loading state */}
				{loading && (
					<div className="flex items-center justify-center py-12">
						<div className="text-sm text-muted-foreground">加载中...</div>
					</div>
				)}

				{/* Empty state */}
				{!loading && flatList.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12">
						<SquareStack className="h-10 w-10 text-muted-foreground/50" />
						<p className="mt-3 text-sm text-muted-foreground">暂无版块</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-4"
							onClick={() => setCreateOpen(true)}
						>
							<Plus className="mr-2 h-4 w-4" />
							创建第一个分区
						</Button>
					</div>
				)}

				{/* Forum list */}
				{!loading &&
					flatList.map((node, index) => (
						<ForumRow
							key={node.id}
							node={node}
							isLast={isLastAtDepth(index, node.depth)}
							onEdit={setEditForum}
							onToggleStatus={handleToggleStatus}
							onMerge={setMergeSource}
							onDelete={handleDelete}
						/>
					))}
			</div>

			{/* Legend */}
			<div className="flex items-center gap-6 text-xs text-muted-foreground">
				<div className="flex items-center gap-1.5">
					<TypeIcon type="group" />
					<span>分区 (Group)</span>
				</div>
				<div className="flex items-center gap-1.5">
					<TypeIcon type="forum" />
					<span>版块 (Forum)</span>
				</div>
				<div className="flex items-center gap-1.5">
					<TypeIcon type="sub" />
					<span>子版块 (Sub)</span>
				</div>
			</div>

			{/* Dialogs */}
			<ForumCreateDialog
				open={createOpen}
				onOpenChange={(open) => {
					setCreateOpen(open);
					if (!open) setCreateError(null);
				}}
				forums={rawData}
				loading={createLoading}
				error={createError}
				onSave={handleCreate}
			/>

			<ForumEditDialog
				open={editForum !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditForum(null);
						setEditError(null);
					}
				}}
				forum={editForum}
				forums={rawData}
				loading={editLoading}
				error={editError}
				onSave={handleEdit}
			/>

			<ForumMergeDialog
				open={mergeSource !== null}
				onOpenChange={(open) => {
					if (!open) {
						setMergeSource(null);
						setMergeError(null);
					}
				}}
				source={mergeSource}
				forums={rawData}
				loading={mergeLoading}
				error={mergeError}
				onMerge={handleMerge}
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
				loading={confirmLoading}
				error={confirmError}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
