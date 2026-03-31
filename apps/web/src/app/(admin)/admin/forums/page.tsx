"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { ForumCreateDialog } from "@/components/admin/forum-create-dialog";
import { ForumMergeDialog } from "@/components/admin/forum-merge-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type Forum,
	type ForumCreate,
	type ForumUpdate,
	createForum,
	deleteForum,
	fetchForums,
	mergeForums,
	statusLabel,
	updateForum,
} from "@/viewmodels/admin/forums";
import { MoreHorizontal, Plus } from "lucide-react";
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
];

// ---------------------------------------------------------------------------
// Status badge variant
// ---------------------------------------------------------------------------

function statusVariant(status: number): "default" | "secondary" {
	return status === 0 ? "secondary" : "default";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ForumsPage() {
	const [data, setData] = useState<Forum[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 50,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		status: "",
	});

	// Dialog states
	const [createOpen, setCreateOpen] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
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

	// Inline edit state
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editDisplayOrder, setEditDisplayOrder] = useState(0);

	// -----------------------------------------------------------------------
	// Data fetching
	// -----------------------------------------------------------------------

	const fetchData = useCallback(
		async (_page = 1) => {
			setLoading(true);
			try {
				const result = await fetchForums();
				// Client-side filtering (Worker returns all forums, no server filter params)
				let filtered = result.data;
				if (filters.search) {
					const q = filters.search.toLowerCase();
					filtered = filtered.filter(
						(f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q),
					);
				}
				if (filters.status) {
					filtered = filtered.filter((f) => f.status === Number(filters.status));
				}
				setData(filtered);
				setPagination({
					page: 1,
					pages: 1,
					total: filtered.length,
					limit: filtered.length || 50,
				});
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		},
		[filters],
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
		setFilters({ search: "", status: "" });
	}, []);

	const handleCreate = useCallback(
		async (formData: ForumCreate) => {
			setCreateLoading(true);
			try {
				await createForum(formData);
				setCreateOpen(false);
				fetchData(pagination.page);
			} finally {
				setCreateLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const startEdit = useCallback((forum: Forum) => {
		setEditingId(forum.id);
		setEditName(forum.name);
		setEditDescription(forum.description);
		setEditDisplayOrder(forum.displayOrder);
	}, []);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
	}, []);

	const saveEdit = useCallback(
		async (id: number) => {
			const update: ForumUpdate = {
				name: editName.trim(),
				description: editDescription.trim(),
				displayOrder: editDisplayOrder,
			};
			await updateForum(id, update);
			setEditingId(null);
			fetchData(pagination.page);
		},
		[editName, editDescription, editDisplayOrder, fetchData, pagination.page],
	);

	const handleToggleStatus = useCallback(
		async (forum: Forum) => {
			await updateForum(forum.id, { status: forum.status === 1 ? 0 : 1 });
			fetchData(pagination.page);
		},
		[fetchData, pagination.page],
	);

	const handleDelete = useCallback(
		(forum: Forum) => {
			setConfirmDialog({
				open: true,
				title: "删除版块",
				description: `删除版块「${forum.name}」？该版块必须没有主题。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deleteForum(forum.id);
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

	const handleMerge = useCallback(
		async (sourceId: number, targetId: number) => {
			setMergeLoading(true);
			try {
				await mergeForums(sourceId, targetId);
				setMergeSource(null);
				fetchData(pagination.page);
			} finally {
				setMergeLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	// -----------------------------------------------------------------------
	// Column definitions
	// -----------------------------------------------------------------------

	const columns: ColumnDef<Forum>[] = [
		{
			key: "name",
			header: "名称",
			cell: (row) =>
				editingId === row.id ? (
					<input
						value={editName}
						onChange={(e) => setEditName(e.target.value)}
						className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
						maxLength={100}
					/>
				) : (
					<span className="font-medium">{row.name}</span>
				),
		},
		{
			key: "description",
			header: "描述",
			cell: (row) =>
				editingId === row.id ? (
					<input
						value={editDescription}
						onChange={(e) => setEditDescription(e.target.value)}
						className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
						maxLength={500}
					/>
				) : (
					<span className="text-muted-foreground text-sm">{row.description || "\u2014"}</span>
				),
		},
		{
			key: "threads",
			header: "主题",
			cell: (row) => row.threads.toLocaleString(),
			className: "text-right",
		},
		{
			key: "posts",
			header: "帖子",
			cell: (row) => row.posts.toLocaleString(),
			className: "text-right",
		},
		{
			key: "displayOrder",
			header: "排序",
			cell: (row) =>
				editingId === row.id ? (
					<input
						type="number"
						value={editDisplayOrder}
						onChange={(e) => setEditDisplayOrder(Number(e.target.value))}
						className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-right"
						min={0}
					/>
				) : (
					row.displayOrder
				),
			className: "text-right",
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
		},
		{
			key: "actions",
			header: "",
			cell: (row) =>
				editingId === row.id ? (
					<div className="flex gap-1">
						<Button size="sm" variant="ghost" onClick={() => saveEdit(row.id)}>
							保存
						</Button>
						<Button size="sm" variant="ghost" onClick={cancelEdit}>
							取消
						</Button>
					</div>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="ghost" size="icon" className="h-8 w-8">
									<MoreHorizontal className="h-4 w-4" />
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => startEdit(row)}>编辑</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleToggleStatus(row)}>
								{row.status === 1 ? "隐藏" : "显示"}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setMergeSource(row)}>合并</DropdownMenuItem>
							{row.threads === 0 && (
								<DropdownMenuItem onClick={() => handleDelete(row)} className="text-destructive">
									删除
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				),
			className: "w-10",
		},
	];

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">版块</h1>
					<p className="mt-1 text-sm text-muted-foreground">管理版块分类</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					创建版块
				</Button>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="rounded-lg border bg-card">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					loading={loading}
					emptyMessage="暂无版块"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<ForumCreateDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				loading={createLoading}
				onSave={handleCreate}
			/>

			<ForumMergeDialog
				open={mergeSource !== null}
				onOpenChange={(open) => !open && setMergeSource(null)}
				source={mergeSource}
				forums={data}
				loading={mergeLoading}
				onMerge={handleMerge}
			/>

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
