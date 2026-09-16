"use client";

import { formatDate } from "@ellie/shared";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	LayerCard,
	Separator,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Eye,
	EyeOff,
	FolderOpen,
	GitBranch,
	Layers,
	Merge,
	MoreHorizontal,
	Pencil,
	Plus,
	SquareStack,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { ForumCreateDialog } from "@/components/admin/forum-create-dialog";
import { ForumEditDialog } from "@/components/admin/forum-edit-dialog";
import { ForumMergeDialog } from "@/components/admin/forum-merge-dialog";
import { extractErrorMessage } from "@/lib/admin-error";
import { forumStatusVariant, forumTypeVariant } from "@/viewmodels/admin/badges";
import {
	buildForumTree,
	createForum,
	deleteForum,
	type Forum,
	type ForumCreate,
	type ForumTreeNode,
	type ForumUpdate,
	fetchForums,
	flattenForumTree,
	mergeForums,
	statusLabel,
	typeLabel,
	updateForum,
} from "@/viewmodels/admin/forums";

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
	return <Badge variant={forumStatusVariant(status)}>{statusLabel(status)}</Badge>;
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
			return <SquareStack className="h-4 w-4 text-basalt-muted-foreground" />;
	}
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

	const columns: ColumnDef<ForumTreeNode>[] = [
		{
			key: "forum",
			header: "版块层级",
			cell: (node) => (
				<div className="flex min-w-52 items-center gap-2" style={{ paddingLeft: node.depth * 20 }}>
					<TypeIcon type={node.type} />
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							{node.type === "group" ? (
								<span className="font-medium">{node.name}</span>
							) : (
								<Link
									className="max-w-56 truncate font-medium hover:text-basalt-primary hover:underline"
									href={`/admin/threads?forumId=${node.id}`}
									title={node.name}
								>
									{node.name}
								</Link>
							)}
							<Badge variant={forumTypeVariant(node.type)}>{typeLabel(node.type)}</Badge>
						</div>
						<p
							className="mt-0.5 max-w-80 truncate text-[11px] text-basalt-muted-foreground"
							title={node.description}
						>
							#{node.id}
							{node.description ? ` · ${node.description}` : ""}
						</p>
					</div>
				</div>
			),
		},
		{ key: "status", header: "状态", cell: (node) => <StatusBadge status={node.status} /> },
		{
			key: "threads",
			header: "主题",
			className: "text-right tabular-nums",
			cell: (node) => node.threads.toLocaleString(),
		},
		{
			key: "posts",
			header: "帖子",
			className: "text-right tabular-nums",
			cell: (node) => node.posts.toLocaleString(),
		},
		{
			key: "moderators",
			header: "版主",
			cell: (node) => (
				<span className="block max-w-32 truncate text-xs" title={node.moderators}>
					{node.moderators || "—"}
				</span>
			),
		},
		{
			key: "activity",
			header: "最近活动",
			cell: (node) => (
				<div className="max-w-52">
					<div className="text-xs tabular-nums">
						{node.lastPostAt ? formatDate(node.lastPostAt) : "—"}
						{node.lastPoster ? ` · ${node.lastPoster}` : ""}
					</div>
					{node.lastThreadId > 0 && (
						<Link
							href={`/admin/threads/${node.lastThreadId}`}
							className="block truncate text-[11px] text-basalt-muted-foreground hover:underline"
							title={node.lastThreadSubject}
						>
							{node.lastThreadSubject || `主题 #${node.lastThreadId}`}
						</Link>
					)}
				</div>
			),
		},
		{
			key: "order",
			header: "排序",
			className: "text-right tabular-nums",
			cell: (node) => node.displayOrder,
		},
		{
			key: "actions",
			header: "操作",
			className: "w-12",
			cell: (node) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`打开「${node.name}」操作菜单`}
							className="h-8 w-8"
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditForum(node)}>
							<Pencil className="mr-2 h-4 w-4" />
							编辑
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleToggleStatus(node)}>
							{node.status === 1 ? (
								<EyeOff className="mr-2 h-4 w-4" />
							) : (
								<Eye className="mr-2 h-4 w-4" />
							)}
							{node.status === 1 ? "隐藏" : "显示"}
						</DropdownMenuItem>
						<Separator className="my-1" />
						<DropdownMenuItem onClick={() => setMergeSource(node)}>
							<Merge className="mr-2 h-4 w-4" />
							合并到...
						</DropdownMenuItem>
						{node.threads === 0 && !rawData.some((f) => f.parentId === node.id) && (
							<>
								<Separator className="my-1" />
								<DropdownMenuItem
									onClick={() => handleDelete(node)}
									className="text-basalt-destructive"
								>
									<Trash2 className="mr-2 h-4 w-4" />
									删除
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];

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
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Layers aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						版块管理
					</span>
				}
				description="版块层级、内容规模与最近活动"
				actions={
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						创建版块
					</Button>
				}
			/>

			<AdminMetrics
				label="全部版块概览"
				items={[
					{ label: "分区", value: loading ? "—" : stats.groups, icon: Layers },
					{ label: "主版块", value: loading ? "—" : stats.forums, icon: FolderOpen },
					{ label: "子版块", value: loading ? "—" : stats.subs, icon: GitBranch },
					{
						label: "显示 / 隐藏",
						value: loading
							? "—"
							: `${rawData.filter((f) => f.status === 1).length} / ${rawData.filter((f) => f.status === 0).length}`,
						icon: Eye,
					},
				]}
			/>
			{/* Filters */}
			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			{/* Page-level feedback (visibility toggle / merge) */}
			{pageMessage && <AdminInlineMessage variant={pageMessage.type} text={pageMessage.text} />}

			<LayerCard padding="none" className="overflow-hidden">
				<AdminDataTable
					label="版块层级列表"
					columns={columns}
					data={flatList}
					getRowId={(node) => node.id}
					loading={loading}
					emptyMessage="暂无版块"
				/>
				<LayerCard.Footer className="justify-between text-xs text-basalt-muted-foreground">
					<span>
						显示 {flatList.length} 项 / 全部 {rawData.length} 项
					</span>
					<span>点击版块查看主题</span>
				</LayerCard.Footer>
			</LayerCard>

			{/* Legend */}
			<div className="flex flex-wrap items-center gap-4 text-xs text-basalt-muted-foreground">
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
