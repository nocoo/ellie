"use client";

import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Label } from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
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
			<AdminDialogContent size="lg" aria-describedby={undefined}>
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
			</AdminDialogContent>
		</Dialog>
	);
}
