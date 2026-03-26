// components/forum/thread-reply-form.tsx — Reply form for thread detail page
// Ref: 04d §帖子详情 — reply entry at bottom of thread
//
// Client component: submits reply via API and refreshes on success.

"use client";

import { PostEditor } from "@/components/forum/post-editor";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ThreadReplyFormProps {
	threadId: number;
	closed: boolean;
}

export function ThreadReplyForm({ threadId, closed }: ThreadReplyFormProps) {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (data: { subject?: string; content: string }) => {
		if (!data.content.trim()) return;

		setSubmitting(true);
		setError(null);

		try {
			const res = await fetch("/api/v1/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					threadId,
					content: data.content,
				}),
			});

			if (!res.ok) {
				const json = await res.json().catch(() => null);
				setError(json?.error ?? `Failed to post reply (${res.status})`);
				return;
			}

			// Refresh the page to show the new reply
			router.refresh();
		} catch {
			setError("An unexpected error occurred.");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="rounded-[14px] bg-card p-6">
			<h2 className="mb-3 text-lg font-semibold">Reply</h2>
			{error && (
				<div className="mb-3 rounded-[10px] bg-destructive/10 p-3 text-sm text-destructive">
					{error}
				</div>
			)}
			<PostEditor mode="reply" submitting={submitting} onSubmit={handleSubmit} closed={closed} />
		</div>
	);
}
