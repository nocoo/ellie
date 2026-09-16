"use client";

// components/forum/move-dialog.tsx — Move thread to another forum dialog

import type { Forum } from "@ellie/types";
import { buildForumTree, type ForumTreeNode } from "@ellie/types";
import { ArrowRight, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface MoveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentForumId: number;
	onConfirm: (targetForumId: number) => void;
	loading?: boolean;
}

export function MoveDialog({
	open,
	onOpenChange,
	currentForumId,
	onConfirm,
	loading,
}: MoveDialogProps) {
	const [tree, setTree] = useState<ForumTreeNode[]>([]);
	const [selected, setSelected] = useState<number | null>(null);
	const [loadingForums, setLoadingForums] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the request after a load failure.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setSelected(null);
		setTree([]);
		setError(null);
		setLoadingForums(true);
		apiClient
			.get<Forum[]>("/api/v1/forums")
			.then(({ data }) => {
				if (cancelled) return;
				setTree(buildForumTree(data));
			})
			.catch(() => {
				if (!cancelled) setError("版块列表加载失败，请重试");
			})
			.finally(() => {
				if (!cancelled) setLoadingForums(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, attempt]);

	const handleConfirm = () => {
		if (selected !== null && !loading && !loadingForums && !error) {
			onConfirm(selected);
		}
	};

	// Render forum tree recursively
	const renderTree = (nodes: ForumTreeNode[], depth = 0) => {
		return nodes.map((node) => {
			const isCurrent = node.id === currentForumId;
			const isGroup = node.type === "group";
			const canSelect = !isGroup && !isCurrent;

			return (
				<div key={node.id}>
					<button
						type="button"
						disabled={!canSelect || loading}
						aria-pressed={selected === node.id}
						className={cn(
							"w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left",
							canSelect && selected === node.id && "bg-primary/10 border border-primary",
							canSelect && selected !== node.id && "hover:bg-muted",
							!canSelect && "opacity-50 cursor-not-allowed",
							isCurrent && "bg-muted",
						)}
						style={{ paddingLeft: `${depth * 16 + 12}px` }}
						onClick={() => canSelect && setSelected(node.id)}
					>
						{isGroup ? (
							<FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
						) : (
							<Folder className="h-4 w-4 shrink-0 text-primary" />
						)}
						<span className={cn("min-w-0 flex-1 break-words", isGroup && "font-medium")}>
							{node.name}
						</span>
						{isCurrent && <span className="shrink-0 text-xs text-muted-foreground">当前</span>}
					</button>
					{node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
				</div>
			);
		});
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<DialogContent
				className="flex flex-col overflow-hidden sm:max-w-lg"
				showCloseButton={!loading}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ArrowRight className="h-5 w-5 text-primary" />
						移动主题
					</DialogTitle>
					<DialogDescription>选择要移动到的目标版块</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 max-h-96 flex-1 overflow-y-auto overscroll-contain space-y-1 py-2">
					{loadingForums ? (
						<div className="flex items-center justify-center py-8 text-muted-foreground">
							加载版块列表...
						</div>
					) : error ? (
						<div className="space-y-3 rounded-lg bg-muted/40 p-5 text-center">
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
							<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
								<RefreshCw className="h-4 w-4" />
								重新加载
							</Button>
						</div>
					) : tree.length === 0 ? (
						<div className="flex items-center justify-center py-8 text-muted-foreground">
							没有可用的版块
						</div>
					) : (
						renderTree(tree)
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={loading || loadingForums || !!error || selected === null}
					>
						{loading ? "处理中..." : "移动"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
