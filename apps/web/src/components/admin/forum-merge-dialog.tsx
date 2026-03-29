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
					<DialogTitle>Merge Forum</DialogTitle>
					<DialogDescription>
						Move all threads from &ldquo;{source?.name}&rdquo; into another forum. The source forum
						will be deleted after merging.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="merge-source">Source</Label>
						<Input id="merge-source" value={source?.name ?? ""} disabled />
					</div>

					<div className="grid gap-2">
						<Label htmlFor="merge-target">Target Forum</Label>
						<select
							id="merge-target"
							value={targetId ?? ""}
							onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
							className="h-9 rounded-md border border-input bg-background px-3 text-sm"
						>
							<option value="">Select target forum...</option>
							{targetOptions.map((f) => (
								<option key={f.id} value={f.id}>
									{f.name} ({f.threads} threads)
								</option>
							))}
						</select>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleMerge}
						disabled={targetId === null || loading}
					>
						{loading ? "Merging..." : "Merge Forum"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
