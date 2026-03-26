// (forum)/threads/new/page.tsx — New thread page
// Ref: 04d §发帖流程 — subject + content + forum selection
//
// Client component: posts new thread via API on submit.
// Accepts ?forumId= search param for pre-selecting forum.

"use client";

import { PostEditor } from "@/components/forum/post-editor";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function NewThreadPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const forumId = Number(searchParams.get("forumId") ?? 0);

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (data: { subject?: string; content: string }) => {
		if (!forumId || !data.subject || !data.content) {
			setError("Forum, subject, and content are required.");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			const res = await fetch("/api/v1/threads", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					forumId,
					subject: data.subject,
					content: data.content,
				}),
			});

			if (!res.ok) {
				const json = await res.json().catch(() => null);
				setError(json?.error ?? `Failed to create thread (${res.status})`);
				return;
			}

			const json = await res.json();
			const threadId = json.data?.id;
			if (threadId) {
				router.push(`/threads/${threadId}`);
			} else {
				router.push(`/forums/${forumId}`);
			}
		} catch {
			setError("An unexpected error occurred.");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className="rounded-[14px] bg-card p-6">
				<h1 className="text-2xl font-bold">New Thread</h1>
				{forumId > 0 ? (
					<p className="mt-1 text-sm text-muted-foreground">Posting in Forum #{forumId}</p>
				) : (
					<p className="mt-1 text-sm text-destructive">
						No forum selected. Add ?forumId=N to the URL.
					</p>
				)}
			</div>

			{error && (
				<div className="rounded-[14px] bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
			)}

			<div className="rounded-[14px] bg-card p-6">
				<PostEditor mode="thread" submitting={submitting} onSubmit={handleSubmit} />
			</div>
		</div>
	);
}
