"use client";

import { Checkbox } from "@nocoo/basalt";
import { Empty } from "@nocoo/basalt/components/empty";
import { Loader } from "@nocoo/basalt/components/loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnDef<T> {
	/** Unique column key */
	key: string;
	/** Column header label */
	header: string;
	/** Render cell content */
	cell: (row: T) => React.ReactNode;
	/** Optional className for the cell */
	className?: string;
}

export interface AdminDataTableProps<T> {
	/** Column definitions */
	columns: ColumnDef<T>[];
	/** Data rows */
	data: T[];
	/** Extract unique ID from row */
	getRowId: (row: T) => string | number;
	/** Currently selected row IDs */
	selectedIds?: Set<string | number>;
	/** Selection change callback */
	onSelectionChange?: (ids: Set<string | number>) => void;
	/** Whether to show row selection checkboxes */
	selectable?: boolean;
	/** Loading state */
	loading?: boolean;
	/** Empty state message */
	emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminDataTable<T>({
	columns,
	data,
	getRowId,
	selectedIds = new Set(),
	onSelectionChange,
	selectable = false,
	loading = false,
	emptyMessage = "暂无数据",
}: AdminDataTableProps<T>) {
	const allIds = useMemo(() => data.map(getRowId), [data, getRowId]);

	const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
	const someSelected = !allSelected && allIds.some((id) => selectedIds.has(id));

	const toggleAll = useCallback(() => {
		if (!onSelectionChange) return;
		if (allSelected) {
			onSelectionChange(new Set());
		} else {
			onSelectionChange(new Set(allIds));
		}
	}, [allSelected, allIds, onSelectionChange]);

	const toggleRow = useCallback(
		(id: string | number) => {
			if (!onSelectionChange) return;
			const next = new Set(selectedIds);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			onSelectionChange(next);
		},
		[selectedIds, onSelectionChange],
	);

	// Loading state
	if (loading) {
		return (
			<div role="status" className="flex items-center justify-center gap-2 py-12">
				<Loader size={16} />
				<p className="text-sm text-basalt-muted-foreground">加载中...</p>
			</div>
		);
	}

	// Empty state
	if (data.length === 0) {
		return <Empty title={emptyMessage} className="py-12" />;
	}

	return (
		<Table className="whitespace-nowrap">
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					{selectable && (
						<TableHead className="w-10">
							<Checkbox
								checked={someSelected ? "indeterminate" : allSelected}
								onCheckedChange={toggleAll}
								aria-label="全选"
							/>
						</TableHead>
					)}
					{columns.map((col) => (
						<TableHead key={col.key} className={col.className}>
							{col.header}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{data.map((row) => {
					const id = getRowId(row);
					const isSelected = selectedIds.has(id);
					return (
						<TableRow key={id} aria-selected={selectable ? isSelected : undefined}>
							{selectable && (
								<TableCell>
									<Checkbox
										checked={isSelected}
										onCheckedChange={() => toggleRow(id)}
										aria-label={`选择行 ${id}`}
									/>
								</TableCell>
							)}
							{columns.map((col) => (
								<TableCell key={col.key} className={col.className}>
									{col.cell(row)}
								</TableCell>
							))}
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
