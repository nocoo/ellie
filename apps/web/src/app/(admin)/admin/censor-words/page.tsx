"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { CensorWordCreateDialog } from "@/components/admin/censor-word-create-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type CensorWord,
	type CensorWordUpdate,
	type TestContentResult,
	batchDeleteCensorWords,
	deleteCensorWord,
	replacementDisplay,
	updateCensorWord,
} from "@/viewmodels/admin/censor-words";
import { MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [{ key: "search", label: "Search words...", type: "search" }];

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "delete", label: "Delete Selected", variant: "destructive" },
];

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
		async (data: { word: string; replacement?: string }) => {
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
				title: "Delete Censor Word",
				description: `Delete the censor word "${cw.word}"? This cannot be undone.`,
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
			key: "word",
			header: "Word",
			cell: (row) => <span className="font-medium">{row.word}</span>,
		},
		{
			key: "replacement",
			header: "Replacement",
			cell: (row) => (
				<span className="text-muted-foreground">{replacementDisplay(row.replacement)}</span>
			),
		},
		{
			key: "createdAt",
			header: "Created At",
			cell: (row) => new Date(row.createdAt).toLocaleDateString(),
		},
		{
			key: "actions",
			header: "",
			cell: (row) => (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditWord(row)}>Edit</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleDelete(row)} className="text-destructive">
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
			className: "w-10",
		},
	];

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">Censor Words</h1>
					<p className="mt-1 text-sm text-muted-foreground">Manage word censorship filters.</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Add Word
				</Button>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="rounded-xl border bg-card">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="No censor words found"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			{/* Content Test Tool */}
			<div className="rounded-xl border bg-card p-4">
				<h2 className="mb-3 text-lg font-medium text-foreground">Test Content</h2>
				<p className="mb-3 text-sm text-muted-foreground">
					Test how content will be censored against the current word list.
				</p>
				<div className="space-y-3">
					<textarea
						value={testInput}
						onChange={(e) => setTestInput(e.target.value)}
						placeholder="Enter content to test..."
						rows={3}
						className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					/>
					<Button onClick={handleTestContent} disabled={testLoading || !testInput.trim()}>
						{testLoading ? "Testing..." : "Test"}
					</Button>
					{testResult && (
						<div className="rounded-md border bg-muted/50 p-3 text-sm">
							<p className="mb-1">
								<span className="font-medium">Censored:</span> {testResult.censored}
							</p>
							{testResult.matches.length > 0 && (
								<p className="text-muted-foreground">
									<span className="font-medium">Matches:</span> {testResult.matches.join(", ")}
								</p>
							)}
						</div>
					)}
				</div>
			</div>

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
