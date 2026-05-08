"use client";

// components/forum/move-dialog.tsx — Move thread to another forum dialog

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
import type { Forum } from "@ellie/types";
import { type ForumTreeNode, buildForumTree } from "@ellie/types";
import { ArrowRight, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

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
	const [_forums, setForums] = useState<Forum[]>([]);
	const [tree, setTree] = useState<ForumTreeNode[]>([]);
	const [selected, setSelected] = useState<number | null>(null);
	const [loadingForums, setLoadingForums] = useState(false);

	// Fetch forums when dialog opens
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoadingForums(true);
		apiClient
			.get<Forum[]>("/api/v1/forums")
			.then(({ data }) => {
				if (cancelled) return;
				setForums(data);
				setTree(buildForumTree(data));
			})
			.catch(() => {
				// Ignore errors — UI will show "no forums available"
			})
			.finally(() => {
				if (!cancelled) setLoadingForums(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const handleConfirm = () => {
		if (selected !== null) {
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
						disabled={!canSelect}
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
							<FolderOpen className="h-4 w-4 text-muted-foreground" />
						) : (
							<Folder className="h-4 w-4 text-primary" />
						)}
						<span className={cn("flex-1", isGroup && "font-medium")}>{node.name}</span>
						{isCurrent && <span className="text-xs text-muted-foreground">(当前)</span>}
					</button>
					{node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
				</div>
			);
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ArrowRight className="h-5 w-5 text-primary" />
						移动主题
					</DialogTitle>
					<DialogDescription>选择要移动到的目标版块</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto py-4 space-y-1 min-h-[200px]">
					{loadingForums ? (
						<div className="flex items-center justify-center py-8 text-muted-foreground">
							加载版块列表...
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
					<Button onClick={handleConfirm} disabled={loading || selected === null}>
						{loading ? "处理中..." : "移动"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
