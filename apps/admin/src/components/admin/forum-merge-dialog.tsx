"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Select,
} from "@ellie/ui";
import { useCallback, useEffect, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import type { Forum } from "@/viewmodels/admin/forums";
import { typeLabel } from "@/viewmodels/admin/forums";

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
	error?: string | null;
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
	error,
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

	// Only allow merging forums of the same type or into parent types
	const targetOptions = forums.filter((f) => {
		if (!source) return false;
		if (f.id === source.id) return false;
		// Can merge into same type or parent type
		if (source.type === "sub") return f.type === "sub" || f.type === "forum";
		if (source.type === "forum") return f.type === "forum" || f.type === "group";
		if (source.type === "group") return f.type === "group";
		return true;
	});

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

				{error && <AdminInlineMessage variant="error" text={error} dense />}

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="merge-source">来源版块</Label>
						<Input
							id="merge-source"
							value={source ? `${source.name} (${typeLabel(source.type)})` : ""}
							disabled
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="merge-target">目标版块</Label>
						<Select
							id="merge-target"
							value={targetId ?? ""}
							onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
							options={[
								{ value: "", label: "选择目标版块..." },
								...targetOptions.map((f) => ({
									value: f.id,
									label: `[${typeLabel(f.type)}] ${f.name} (${f.threads} 个主题)`,
								})),
							]}
						/>
					</div>

					{source && source.threads > 0 && (
						<div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-600 dark:text-amber-400">
							此版块包含 <strong>{source.threads}</strong> 个主题和 <strong>{source.posts}</strong>{" "}
							个帖子，合并后将全部转移到目标版块。
						</div>
					)}
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
