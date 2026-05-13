"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { PostEditDialog } from "@/components/admin/post-edit-dialog";
import { PostFloor } from "@/components/admin/post-floor";
import { ThreadDetailHeader } from "@/components/admin/thread-detail-header";
import { ThreadEditDialog } from "@/components/admin/thread-edit-dialog";
import { useBreadcrumbOverride } from "@/components/layout/breadcrumb-context";
import { extractErrorMessage } from "@/lib/admin-error";
import { type Forum, fetchForums } from "@/viewmodels/admin/forums";
import type { PostUpdate } from "@/viewmodels/admin/posts";
import { deletePost, updatePost } from "@/viewmodels/admin/posts";
import {
	type EnrichedPost,
	type ThreadDetailData,
	loadThreadDetail,
} from "@/viewmodels/admin/thread-detail";
import { type ThreadUpdate, deleteThread, updateThread } from "@/viewmodels/admin/threads";
import { Button } from "@ellie/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
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

	// Phase H.3 — flat forum list, fetched once for the header breadcrumb.
	// We don't block the page on it; the breadcrumb falls back to `#<id>`
	// while the fetch is in flight and on failure.
	const [forums, setForums] = useState<Forum[]>([]);

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

	const [editThreadError, setEditThreadError] = useState<string | null>(null);
	const [editPostError, setEditPostError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);

	// Dynamic breadcrumb
	useBreadcrumbOverride(data?.thread.subject ?? null);

	const fetchData = useCallback(
		async (page = 1) => {
			if (Number.isNaN(threadId)) {
				setError("无效的主题 ID");
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const result = await loadThreadDetail(threadId, page);
				setData(result);
			} catch (e) {
				setError(e instanceof Error ? e.message : "主题加载失败");
			} finally {
				setLoading(false);
			}
		},
		[threadId],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	// Phase H.3 — forum list is independent of the thread fetch; silently
	// fall back to an empty list if the call fails (header will show
	// `#<id>` for the current forum, no crash).
	useEffect(() => {
		let cancelled = false;
		fetchForums()
			.then((res) => {
				if (!cancelled) setForums(res.data ?? []);
			})
			.catch(() => {
				if (!cancelled) setForums([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	// Thread actions
	const handleEditThreadSave = useCallback(
		async (id: number, update: ThreadUpdate) => {
			setEditThreadLoading(true);
			setEditThreadError(null);
			try {
				await updateThread(id, update);
				setEditThread(false);
				fetchData(data?.pagination.page ?? 1);
			} catch (err) {
				setEditThreadError(extractErrorMessage(err, "保存主题失败"));
			} finally {
				setEditThreadLoading(false);
			}
		},
		[fetchData, data?.pagination.page],
	);

	const handleDeleteThread = useCallback(() => {
		if (!data) return;
		setConfirmError(null);
		setConfirmDialog({
			open: true,
			title: "删除主题",
			description: `删除主题「${data.thread.subject}」及其所有帖子？此操作不可撤销。`,
			variant: "destructive",
			onConfirm: async () => {
				setConfirmLoading(true);
				setConfirmError(null);
				try {
					await deleteThread(threadId);
					setConfirmDialog((d) => ({ ...d, open: false }));
					router.push("/admin/threads");
				} catch (err) {
					setConfirmError(extractErrorMessage(err, "删除主题失败"));
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
			setEditPostError(null);
			try {
				await updatePost(id, update);
				setEditPost(null);
				fetchData(data?.pagination.page ?? 1);
			} catch (err) {
				setEditPostError(extractErrorMessage(err, "保存帖子失败"));
			} finally {
				setEditPostLoading(false);
			}
		},
		[fetchData, data?.pagination.page],
	);

	const handleDeletePost = useCallback(
		(post: EnrichedPost) => {
			if (post.isFirst) return;
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除帖子",
				description: `删除 ${post.authorName} 的第 ${post.position} 楼帖子？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await deletePost(post.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(data?.pagination.page ?? 1);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除帖子失败"));
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
					返回主题列表
				</Button>
				<div className="rounded-xl bg-secondary p-1 overflow-x-auto p-8 text-center text-muted-foreground">
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
				返回主题列表
			</Button>

			{/* Thread header — H.3: forum breadcrumb + meta chips + highlight
			    badge live in <ThreadDetailHeader>. */}
			<ThreadDetailHeader
				thread={thread}
				forums={forums}
				onEdit={() => setEditThread(true)}
				onDelete={handleDeleteThread}
			/>

			{/* Posts list */}
			<div className="space-y-3">
				{posts.map((post) => (
					<PostFloor key={post.id} post={post} onEdit={setEditPost} onDelete={handleDeletePost} />
				))}
			</div>

			{/* Pagination */}
			{pagination.pages > 1 && (
				<div className="rounded-xl bg-secondary p-1 overflow-x-auto">
					<AdminPagination pagination={paginationInfo} onPageChange={handlePageChange} />
				</div>
			)}

			{/* Dialogs */}
			<ThreadEditDialog
				open={editThread}
				onOpenChange={(open) => {
					setEditThread(open);
					if (!open) setEditThreadError(null);
				}}
				thread={thread}
				loading={editThreadLoading}
				error={editThreadError}
				onSave={handleEditThreadSave}
			/>

			<PostEditDialog
				open={editPost !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditPost(null);
						setEditPostError(null);
					}
				}}
				post={editPost}
				loading={editPostLoading}
				error={editPostError}
				onSave={handleEditPostSave}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => {
					setConfirmDialog((d) => ({ ...d, open }));
					if (!open) setConfirmError(null);
				}}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				loading={confirmLoading}
				error={confirmError}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
