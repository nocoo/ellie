"use client";

import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	LayerCard,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Eraser,
	FlaskConical,
	ListFilter,
	MoreHorizontal,
	Pencil,
	Plus,
	Replace,
	ShieldBan,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { CensorWordCreateDialog } from "@/components/admin/censor-word-create-dialog";
import { censorActionVariant } from "@/viewmodels/admin/badges";
import {
	actionLabel,
	batchDeleteCensorWords,
	type CensorWord,
	type CensorWordCreate,
	type CensorWordUpdate,
	deleteCensorWord,
	replacementDisplay,
	type TestContentResult,
	updateCensorWord,
} from "@/viewmodels/admin/censor-words";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [{ key: "search", label: "搜索敏感词...", type: "search" }];

const BATCH_ACTIONS: BatchAction[] = [{ key: "delete", label: "批量删除", variant: "destructive" }];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CensorWordsPage() {
	const [data, setData] = useState<CensorWord[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({ search: "" });
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editWord, setEditWord] = useState<CensorWord | null>(null);
	const [dialogLoading, setDialogLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// Content test state
	const [testInput, setTestInput] = useState("");
	const [testResult, setTestResult] = useState<TestContentResult | null>(null);
	const [testLoading, setTestLoading] = useState(false);

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.search) params.set("find", filters.search);

				const res = await fetch(`/api/admin/censor-words?${params.toString()}`);
				const json = await res.json();
				setData(json.data ?? []);
				setPagination({
					page: json.meta?.page ?? page,
					pages: json.meta?.pages ?? 0,
					total: json.meta?.total ?? 0,
					limit: json.meta?.limit ?? 20,
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
		setFilters({ search: "" });
	}, []);

	const handleCreate = useCallback(
		async (data: CensorWordCreate) => {
			setDialogLoading(true);
			try {
				const res = await fetch("/api/admin/censor-words", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				if (res.ok) {
					setCreateDialogOpen(false);
					fetchData(pagination.page);
				}
			} finally {
				setDialogLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const handleEditSave = useCallback(
		async (id: number, update: CensorWordUpdate) => {
			setDialogLoading(true);
			try {
				await updateCensorWord(id, update);
				setEditWord(null);
				fetchData(pagination.page);
			} finally {
				setDialogLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const handleDelete = useCallback(
		(cw: CensorWord) => {
			setConfirmDialog({
				open: true,
				title: "删除敏感词",
				description: `删除敏感词「${cw.find}」？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deleteCensorWord(cw.id);
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
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;
			if (key === "delete") {
				await batchDeleteCensorWords(ids);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	const handleTestContent = useCallback(async () => {
		if (!testInput.trim()) return;
		setTestLoading(true);
		setTestResult(null);
		try {
			const res = await fetch("/api/admin/censor-words/test", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: testInput }),
			});
			if (res.ok) {
				const json = await res.json();
				setTestResult(json.data ?? null);
			}
		} finally {
			setTestLoading(false);
		}
	}, [testInput]);

	const columns: ColumnDef<CensorWord>[] = [
		{
			key: "find",
			header: "词语",
			cell: (row) => (
				<span className="block max-w-56 truncate font-medium" title={row.find}>
					{row.find}
				</span>
			),
		},
		{
			key: "replacement",
			header: "替换内容",
			cell: (row) => (
				<span
					className="block max-w-56 truncate text-basalt-muted-foreground"
					title={row.action === "ban" ? "不适用" : replacementDisplay(row.replacement)}
				>
					{row.action === "ban" ? "—" : replacementDisplay(row.replacement)}
				</span>
			),
		},
		{
			key: "action",
			header: "动作",
			cell: (row) => (
				<Badge variant={censorActionVariant(row.action)}>{actionLabel(row.action)}</Badge>
			),
		},
		{
			key: "admin",
			header: "创建者",
			cell: (row) =>
				row.adminId > 0 ? (
					<Link
						href={`/admin/users/${row.adminId}`}
						className="text-basalt-primary hover:underline"
					>
						{row.adminName || `UID ${row.adminId}`}
					</Link>
				) : (
					row.adminName || "—"
				),
		},
		{
			key: "createdAt",
			header: "创建时间",
			cell: (row) => new Date(row.createdAt * 1000).toLocaleDateString(),
		},
		{
			key: "actions",
			header: "",
			cell: (row) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label={`敏感词 ${row.find} 操作`}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditWord(row)}>
							<Pencil className="mr-2 h-4 w-4" />
							编辑
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleDelete(row)} className="text-basalt-destructive">
							<Trash2 className="mr-2 h-4 w-4" />
							删除
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
			className: "w-10",
		},
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<ListFilter aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						敏感词
					</span>
				}
				description="管理敏感词过滤规则"
				actions={
					<Button size="sm" onClick={() => setCreateDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						添加敏感词
					</Button>
				}
			/>
			<AdminMetrics
				items={[
					{
						label: "筛选结果",
						value: loading ? "—" : pagination.total,
						icon: ListFilter,
						hint: "当前条件下的全部规则",
					},
					{
						label: "本页禁止发布",
						value: loading ? "—" : data.filter((r) => r.action === "ban").length,
						icon: ShieldBan,
					},
					{
						label: "本页内容替换",
						value: loading ? "—" : data.filter((r) => r.action === "replace").length,
						icon: Replace,
					},
					{
						label: "本页删除匹配内容",
						value: loading
							? "—"
							: data.filter((r) => r.action === "replace" && r.replacement === "").length,
						icon: Eraser,
						hint: "替换为空文本的规则",
					},
				]}
			/>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<LayerCard padding="none" className="overflow-hidden">
				<AdminDataTable
					label="敏感词列表"
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="暂无敏感词"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</LayerCard>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			{/* Content Test Tool */}
			<LayerCard padding="none" className="p-4">
				<h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-basalt-foreground">
					<FlaskConical aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
					内容测试
				</h2>
				<p className="mb-3 text-sm text-basalt-muted-foreground">
					测试内容将如何被当前敏感词列表过滤。
				</p>
				<div className="grid items-start gap-4 lg:grid-cols-2">
					<div className="space-y-3">
						<InputArea
							aria-label="要测试的内容"
							value={testInput}
							onChange={(e) => setTestInput(e.target.value)}
							placeholder="输入要测试的内容..."
							rows={3}
						/>
						<Button onClick={handleTestContent} disabled={testLoading || !testInput.trim()}>
							<FlaskConical aria-hidden="true" className="mr-2 h-4 w-4" />
							{testLoading ? "测试中..." : "测试"}
						</Button>
					</div>
					{!testResult && (
						<div className="rounded-lg border border-dashed border-basalt-border p-4 text-sm text-basalt-muted-foreground">
							输入内容并测试后，这里显示过滤结果与命中词语。
						</div>
					)}
					{testResult && (
						<LayerCard padding="none" className="min-w-0 space-y-2 break-words p-4 text-sm">
							<p className="mb-1">
								<span className="font-medium">过滤结果:</span> {testResult.censored}
							</p>
							{testResult.matches.length > 0 && (
								<p className="text-basalt-muted-foreground">
									<span className="font-medium">匹配词语:</span> {testResult.matches.join(", ")}
								</p>
							)}
						</LayerCard>
					)}
				</div>
			</LayerCard>

			<CensorWordCreateDialog
				open={createDialogOpen || editWord !== null}
				onOpenChange={(open) => {
					if (!open) {
						setCreateDialogOpen(false);
						setEditWord(null);
					}
				}}
				censorWord={editWord}
				loading={dialogLoading}
				onSave={handleCreate}
				onUpdate={handleEditSave}
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
