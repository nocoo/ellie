"use client";

import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Post, PostUpdate } from "@/viewmodels/admin/posts";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	post: Post | null;
	loading?: boolean;
	error?: string | null;
	onSave: (id: number, data: PostUpdate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostEditDialog({
	open,
	onOpenChange,
	post,
	loading = false,
	error,
	onSave,
}: PostEditDialogProps) {
	const [content, setContent] = useState("");

	useEffect(() => {
		if (post) {
			setContent(post.content);
		}
	}, [post]);

	const handleSave = useCallback(() => {
		if (!post || loading) return;
		onSave(post.id, { content });
	}, [post, loading, onSave, content]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg" className="grid gap-4" aria-describedby={undefined}>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon"
						className="absolute right-3 top-3 h-8 w-8"
						aria-label="关闭弹窗"
					>
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>

				<DialogHeader className="pr-8">
					<DialogTitle>编辑帖子</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense />}

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="edit-content">内容</Label>
						<InputArea
							id="edit-content"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							rows={8}
							className="w-full min-w-0 rounded-lg border border-border bg-secondary px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border md:text-sm"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						{loading ? "保存中..." : "保存更改"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
