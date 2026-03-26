// components/forum/post-editor.tsx — Rich text editor for posts
// Ref: 04d §PostEditor — subject + content + submit
// Phase 2: Replace textarea with Tiptap (04e §Tiptap)

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorMode } from "@/viewmodels/forum/post-editor";
import { useState } from "react";

export interface PostEditorProps {
	mode: EditorMode;
	/** Whether the form is currently submitting */
	submitting?: boolean;
	/** Called on submit with subject (thread mode) and content */
	onSubmit: (data: { subject?: string; content: string }) => void;
	/** Called when user cancels */
	onCancel?: () => void;
	/** Whether the thread is closed (reply mode only) */
	closed?: boolean;
}

export function PostEditor({ mode, submitting, onSubmit, onCancel, closed }: PostEditorProps) {
	const [subject, setSubject] = useState("");
	const [content, setContent] = useState("");

	if (closed) {
		return (
			<div className="rounded-[10px] bg-secondary p-4 text-center text-muted-foreground">
				This thread is locked. Replies are not allowed.
			</div>
		);
	}

	const canPost =
		mode === "thread"
			? subject.trim().length > 0 && content.trim().length > 0
			: content.trim().length > 0;

	return (
		<div className="space-y-3">
			{mode === "thread" && (
				<Input
					placeholder="Thread subject..."
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					maxLength={80}
					disabled={submitting}
				/>
			)}

			{/* Phase 2: Replace with Tiptap editor */}
			<textarea
				className="min-h-[120px] w-full rounded-[10px] border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				placeholder={mode === "thread" ? "Write your post..." : "Write your reply..."}
				value={content}
				onChange={(e) => setContent(e.target.value)}
				disabled={submitting}
			/>

			<div className="flex items-center justify-end gap-2">
				{onCancel && (
					<Button variant="ghost" onClick={onCancel} disabled={submitting}>
						Cancel
					</Button>
				)}
				<Button
					onClick={() => onSubmit({ subject: mode === "thread" ? subject : undefined, content })}
					disabled={!canPost || submitting}
				>
					{submitting ? "Posting..." : mode === "thread" ? "Create Thread" : "Post Reply"}
				</Button>
			</div>
		</div>
	);
}
