"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Forum } from "@/viewmodels/admin/forums";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumMergeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The source forum being merged (will be deleted after merge) */
	source: Forum | null;
	/** All forums to choose a target from */
	forums: Forum[];
	loading?: boolean;
	onMerge: (sourceId: number, targetId: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForumMergeDialog({
	open,
	onOpenChange,
	source,
	forums,
	loading = false,
	onMerge,
}: ForumMergeDialogProps) {
	const [targetId, setTargetId] = useState<number | null>(null);

	// Reset selection when source changes
	const sourceId = source?.id ?? null;
	useEffect(() => {
		if (sourceId !== null) {
			setTargetId(null);
		}
	}, [sourceId]);

	const targetOptions = forums.filter((f) => source && f.id !== source.id);

	const handleMerge = useCallback(() => {
		if (!source || targetId === null || loading) return;
		onMerge(source.id, targetId);
	}, [source, targetId, loading, onMerge]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>合并版块</DialogTitle>
					<DialogDescription>
						将来源版块的所有主题移至目标版块，合并后来源版块将被删除。
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="merge-source">来源版块</Label>
						<Input id="merge-source" value={source?.name ?? ""} disabled />
					</div>

					<div className="grid gap-2">
						<Label htmlFor="merge-target">目标版块</Label>
						<select
							id="merge-target"
							value={targetId ?? ""}
							onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
							className="h-9 rounded-md border border-input bg-background px-3 text-sm"
						>
							<option value="">选择目标版块...</option>
							{targetOptions.map((f) => (
								<option key={f.id} value={f.id}>
									{f.name} ({f.threads} 个主题)
								</option>
							))}
						</select>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button
						variant="destructive"
						onClick={handleMerge}
						disabled={targetId === null || loading}
					>
						{loading ? "合并中..." : "合并版块"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
