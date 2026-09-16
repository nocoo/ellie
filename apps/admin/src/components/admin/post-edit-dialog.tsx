"use client";

import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Label } from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { MessageSquare, Save } from "lucide-react";
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
		if (open && post) {
			setContent(post.content);
		}
	}, [open, post]);

	const handleSave = useCallback(() => {
		if (!post || loading) return;
		onSave(post.id, { content });
	}, [post, loading, onSave, content]);

	return (
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<AdminDialogContent
				size="xl"
				aria-describedby={undefined}
				closeDisabled={loading}
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="shrink-0 border-b border-basalt-border/50 px-5 py-4 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						编辑帖子
					</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense className="mx-5 mt-3" />}

				<div className="min-h-0 overflow-y-auto px-5 py-4">
					<fieldset disabled={loading} className="grid min-w-0 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-content">内容</Label>
							<InputArea
								id="edit-content"
								value={content}
								onChange={(e) => setContent(e.target.value)}
								rows={12}
								className="min-h-48 resize-y font-mono text-sm"
							/>
						</div>
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "保存中..." : "保存更改"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
