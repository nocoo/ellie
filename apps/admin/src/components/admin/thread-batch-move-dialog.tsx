"use client";

// thread-batch-move-dialog.tsx — Batch H1 of task #15.
//
// Wraps `<Dialog>` with a forum picker so the operator can move N selected
// threads to a target forum/sub. Errors raised during forum-list fetch or
// the actual move call are rendered INSIDE the dialog (per reviewer
// guidance) so the operator never has to dismiss the dialog to see why a
// move failed. Group-type forums (`type === "group"`) are filtered out
// because the worker `batchMove` rejects them implicitly (forums table
// holds groups too but threads cannot live there).

import { type Forum, fetchForums } from "@/viewmodels/admin/forums";
import { Button } from "@ellie/ui";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ellie/ui";
import { Select } from "@ellie/ui";
import { useEffect, useMemo, useState } from "react";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Filter the raw forum list down to valid move targets:
 *   - drop `type === "group"` (分区) — groups cannot hold threads
 *   - drop `status === 0` (隐藏) — threads should not be hidden via batch
 *
 * Sorted by parentId then displayOrder so siblings group together; consumers
 * are responsible for visual hierarchy hints.
 */
export function filterMoveTargetForums(forums: Forum[]): Forum[] {
	return forums
		.filter((f) => f.type !== "group" && f.status !== 0)
		.slice()
		.sort((a, b) => {
			if (a.parentId !== b.parentId) return a.parentId - b.parentId;
			return a.displayOrder - b.displayOrder;
		});
}

/**
 * Build `<Select>` options from a list of move-target forums. The empty
 * leading option carries the placeholder so the operator must explicitly
 * pick a target; `value === ""` is the unselected state.
 */
export function buildForumSelectOptions(forums: Forum[]): { value: string; label: string }[] {
	const opts: { value: string; label: string }[] = [{ value: "", label: "请选择目标版块…" }];
	for (const f of forums) {
		const prefix = f.type === "sub" ? "  └ " : "";
		opts.push({ value: String(f.id), label: `${prefix}${f.name}` });
	}
	return opts;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ThreadBatchMoveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedCount: number;
	loading: boolean;
	error: string | null;
	/** Called with the chosen forumId once the operator clicks confirm. */
	onConfirm: (forumId: number) => void;
}

export function ThreadBatchMoveDialog({
	open,
	onOpenChange,
	selectedCount,
	loading,
	error,
	onConfirm,
}: ThreadBatchMoveDialogProps) {
	const [forums, setForums] = useState<Forum[]>([]);
	const [forumsLoading, setForumsLoading] = useState(false);
	const [forumsError, setForumsError] = useState<string | null>(null);
	const [selectedForumId, setSelectedForumId] = useState<string>("");

	// Fetch the forum list whenever the dialog opens. Resets state on each
	// open so a previous failed run doesn't show stale errors.
	useEffect(() => {
		if (!open) return;
		setForumsLoading(true);
		setForumsError(null);
		setSelectedForumId("");
		fetchForums()
			.then((res) => {
				setForums(res.data);
			})
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : "加载版块列表失败";
				setForumsError(msg);
				setForums([]);
			})
			.finally(() => setForumsLoading(false));
	}, [open]);

	const targets = useMemo(() => filterMoveTargetForums(forums), [forums]);
	const options = useMemo(() => buildForumSelectOptions(targets), [targets]);

	const canConfirm = selectedForumId !== "" && !loading && !forumsLoading;

	const handleConfirm = () => {
		const id = Number(selectedForumId);
		if (!Number.isInteger(id) || id <= 0) return;
		onConfirm(id);
	};

	const handleOpenChange = (next: boolean) => {
		if (loading) return; // mirror AdminConfirmDialog: lock during in-flight
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>批量移动主题</DialogTitle>
					<DialogDescription>
						{`将选中的 ${selectedCount} 个主题移动到目标版块。已位于目标版块的主题会被服务端跳过。`}
					</DialogDescription>
				</DialogHeader>

				{/* Errors render INSIDE the dialog so the operator can see them
				    without dismissing. forumsError covers fetch failures;
				    error covers the move call itself. */}
				{forumsError && <AdminInlineMessage variant="error" text={forumsError} dense />}
				{error && <AdminInlineMessage variant="error" text={error} dense />}

				<div className="py-2">
					<label
						htmlFor="thread-batch-move-target"
						className="mb-2 block text-sm text-muted-foreground"
					>
						目标版块
					</label>
					<Select
						id="thread-batch-move-target"
						value={selectedForumId}
						onChange={(e) => setSelectedForumId(e.target.value)}
						options={options}
						aria-label="目标版块"
						disabled={forumsLoading || loading}
					/>
					{forumsLoading && <p className="mt-2 text-xs text-muted-foreground">正在加载版块列表…</p>}
					{!forumsLoading && targets.length === 0 && !forumsError && (
						<p className="mt-2 text-xs text-muted-foreground">未找到可用版块</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleConfirm} disabled={!canConfirm}>
						{loading ? "处理中..." : "确认移动"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
