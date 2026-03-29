"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { PostEditDialog } from "@/components/admin/post-edit-dialog";
import { PostFloor } from "@/components/admin/post-floor";
import { ThreadEditDialog } from "@/components/admin/thread-edit-dialog";
import { useBreadcrumbOverride } from "@/components/layout/breadcrumb-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PostUpdate } from "@/viewmodels/admin/posts";
import { deletePost, updatePost } from "@/viewmodels/admin/posts";
import {
	type EnrichedPost,
	type ThreadDetailData,
	loadThreadDetail,
} from "@/viewmodels/admin/thread-detail";
import {
	type ThreadUpdate,
	deleteThread,
	digestLabel,
	stickyLabel,
	updateThread,
} from "@/viewmodels/admin/threads";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ThreadDetailPage() {
	const params = useParams();
	const router = useRouter();
	const threadId = Number(params.id);

	const [data, setData] = useState<ThreadDetailData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Dialog states
	const [editThread, setEditThread] = useState(false);
	const [editThreadLoading, setEditThreadLoading] = useState(false);
	const [editPost, setEditPost] = useState<EnrichedPost | null>(null);
	const [editPostLoading, setEditPostLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// Dynamic breadcrumb
	useBreadcrumbOverride(data?.thread.subject ?? null);

	const fetchData = useCallback(
		async (page = 1) => {
			if (Number.isNaN(threadId)) {
				setError("Invalid thread ID");
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const result = await loadThreadDetail(threadId, page);
				setData(result);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to load thread");
			} finally {
				setLoading(false);
			}
		},
		[threadId],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	// Thread actions
	const handleEditThreadSave = useCallback(
		async (id: number, update: ThreadUpdate) => {
			setEditThreadLoading(true);
			try {
				await updateThread(id, update);
				setEditThread(false);
				fetchData(data?.pagination.page ?? 1);
			} finally {
				setEditThreadLoading(false);
			}
		},
		[fetchData, data?.pagination.page],
	);

	const handleDeleteThread = useCallback(() => {
		if (!data) return;
		setConfirmDialog({
			open: true,
			title: "Delete Thread",
			description: `Delete "${data.thread.subject}" and all its posts? This cannot be undone.`,
			variant: "destructive",
			onConfirm: async () => {
				setConfirmLoading(true);
				try {
					await deleteThread(threadId);
					setConfirmDialog((d) => ({ ...d, open: false }));
					router.push("/admin/threads");
				} finally {
					setConfirmLoading(false);
				}
			},
		});
	}, [data, threadId, router]);

	// Post actions
	const handleEditPostSave = useCallback(
		async (id: number, update: PostUpdate) => {
			setEditPostLoading(true);
			try {
				await updatePost(id, update);
				setEditPost(null);
				fetchData(data?.pagination.page ?? 1);
			} finally {
				setEditPostLoading(false);
			}
		},
		[fetchData, data?.pagination.page],
	);

	const handleDeletePost = useCallback(
		(post: EnrichedPost) => {
			if (post.isFirst) return;
			setConfirmDialog({
				open: true,
				title: "Delete Post",
				description: `Delete post #${post.position} by ${post.authorName}? This cannot be undone.`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deletePost(post.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(data?.pagination.page ?? 1);
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, data?.pagination.page],
	);

	// Loading state
	if (loading && !data) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className="space-y-4">
				<Button variant="ghost" size="sm" onClick={() => router.push("/admin/threads")}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Threads
				</Button>
				<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
					{error}
				</div>
			</div>
		);
	}

	if (!data) return null;

	const { thread, posts, pagination } = data;
	const paginationInfo: PaginationInfo = {
		page: pagination.page,
		pages: pagination.pages,
		total: pagination.total,
		limit: pagination.limit,
	};

	return (
		<div className="space-y-4">
			{/* Back button */}
			<Button variant="ghost" size="sm" onClick={() => router.push("/admin/threads")}>
				<ArrowLeft className="mr-2 h-4 w-4" />
				Back to Threads
			</Button>

			{/* Thread header */}
			<div className="rounded-xl border bg-card p-4 md:p-6">
				<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div className="space-y-2 min-w-0">
						<h1 className="text-xl md:text-2xl font-semibold text-foreground break-words">
							{thread.subject}
						</h1>
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<span>by {thread.authorName}</span>
							<span>·</span>
							<span>{new Date(thread.createdAt * 1000).toLocaleString()}</span>
							<span>·</span>
							<span>{thread.replies} replies</span>
							<span>·</span>
							<span>{thread.views.toLocaleString()} views</span>
						</div>
						<div className="flex flex-wrap gap-1.5">
							{thread.sticky > 0 && <Badge variant="default">{stickyLabel(thread.sticky)}</Badge>}
							{thread.closed > 0 && <Badge variant="secondary">Closed</Badge>}
							{thread.digest > 0 && <Badge variant="outline">{digestLabel(thread.digest)}</Badge>}
						</div>
					</div>

					<div className="flex gap-2 shrink-0">
						<Button variant="outline" size="sm" onClick={() => setEditThread(true)}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</Button>
						<Button variant="destructive" size="sm" onClick={handleDeleteThread}>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</Button>
					</div>
				</div>
			</div>

			{/* Posts list */}
			<div className="space-y-3">
				{posts.map((post) => (
					<PostFloor key={post.id} post={post} onEdit={setEditPost} onDelete={handleDeletePost} />
				))}
			</div>

			{/* Pagination */}
			{pagination.pages > 1 && (
				<div className="rounded-xl border bg-card">
					<AdminPagination pagination={paginationInfo} onPageChange={handlePageChange} />
				</div>
			)}

			{/* Dialogs */}
			<ThreadEditDialog
				open={editThread}
				onOpenChange={setEditThread}
				thread={thread}
				loading={editThreadLoading}
				onSave={handleEditThreadSave}
			/>

			<PostEditDialog
				open={editPost !== null}
				onOpenChange={(open) => !open && setEditPost(null)}
				post={editPost}
				loading={editPostLoading}
				onSave={handleEditPostSave}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				loading={confirmLoading}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
