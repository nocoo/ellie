"use client";
import { FloatingToolbar } from "@/components/forum/floating-toolbar";
import { PostCard } from "@/components/forum/post-card";
import { ReplyDialog } from "@/components/forum/reply-dialog";
import { ThreadModMenu } from "@/components/forum/thread-mod-menu";
import { getStaticImageUrl } from "@/lib/cdn";
import { buildQuoteSnippet } from "@/lib/text";
import type { EnrichedPost } from "@/viewmodels/forum/thread-detail";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { formatDateTime } from "@/viewmodels/shared/formatting";
import type { Thread, UserRole } from "@ellie/types";
import { useCallback, useEffect, useState } from "react";

interface ThreadPostsClientProps {
	thread: Thread;
	posts: EnrichedPost[];
	canModerateForum: boolean;
	/** Can manage thread (sticky/highlight/digest/close) */
	canManageThread: boolean;
	/** Can move thread (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can delete thread (SuperMod/Admin or author) */
	canDeleteThread: boolean;
	currentUserId: number | null;
	/**
	 * Real session role of the current viewer. `null` for anonymous or when
	 * the loader couldn't resolve it. Forwarded into `PostCard` so the
	 * rating action-bar entries (docs/22 §7.1) can decide whether to show
	 * the 积分 button. Worker still enforces the permission gate.
	 */
	currentUserRole: UserRole | null;
	/**
	 * Server-side projected `emailVerifiedAt` for the current user.
	 * `null` means anonymous OR the loader fail-soft pathed (server
	 * couldn't tell). Per Phase 7-4 reviewer guidance (msg 58c38e78),
	 * we only block when this is exactly `0`; null falls through to the
	 * api-client interceptor backstop.
	 */
	selfEmailVerifiedAt: number | null;
	/** Previous page URL for pagination */
	prevHref?: string | null;
	/** Next page URL for pagination */
	nextHref?: string | null;
	/** Back/escape URL (e.g. parent forum with page context) */
	backHref?: string;
	/** Jump-to-page config (page-based via ?page=N) */
	jumpPage?: { basePath: string; pages: number; returnTo?: string };
}

export function ThreadPostsClient({
	thread,
	posts,
	canModerateForum,
	canManageThread,
	canMoveThread,
	canDeleteThread,
	currentUserId,
	currentUserRole,
	selfEmailVerifiedAt,
	prevHref,
	nextHref,
	backHref,
	jumpPage,
}: ThreadPostsClientProps) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [quotedPost, setQuotedPost] = useState<{
		content: string;
		author: string;
		time: string;
	} | null>(null);

	const handleReply = useCallback(
		async (post?: EnrichedPost) => {
			// Unified write-gate preflight: checks email verification AND
			// posting restrictions before opening the editor.
			if (await writeGatePreflight(selfEmailVerifiedAt, "reply")) return;
			if (post) {
				// Quote reply - extract plain text snippet for quote
				const snippet = buildQuoteSnippet(post.content);
				const timeStr = formatDateTime(post.createdAt);
				setQuotedPost({
					content: snippet,
					author: post.author?.username ?? "匿名",
					time: timeStr,
				});
			} else {
				setQuotedPost(null);
			}
			setReplyOpen(true);
		},
		[selfEmailVerifiedAt],
	);

	const handleQuickReply = useCallback(async () => {
		if (await writeGatePreflight(selfEmailVerifiedAt, "reply")) return;
		setQuotedPost(null);
		setReplyOpen(true);
	}, [selfEmailVerifiedAt]);

	useEffect(() => {
		const hash = window.location.hash;
		if (/^#post-\d+$/.test(hash)) {
			const el = document.querySelector(hash);
			el?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, []);

	return (
		<>
			{/* Thread toolbar — reply button + mod actions (before posts) */}
			<ThreadToolbar
				thread={thread}
				canManageThread={canManageThread}
				canMoveThread={canMoveThread}
				canDeleteThread={canDeleteThread}
				onReply={handleQuickReply}
			/>

			{/* Posts */}
			{posts.map((post) => {
				const isFirst = post.isFirst || post.position === 1;
				return (
					<PostCard
						key={post.id}
						post={post}
						threadDigest={isFirst ? thread.digest : undefined}
						threadClosed={thread.closed === 1}
						onReply={() => handleReply(post)}
						canModerate={canModerateForum}
						currentUserId={currentUserId}
						currentUserRole={currentUserRole}
						selfEmailVerifiedAt={selfEmailVerifiedAt}
						threadAuthorId={thread.authorId}
					/>
				);
			})}

			{/* Thread toolbar — reply button + mod actions (after posts) */}
			<ThreadToolbar
				thread={thread}
				canManageThread={canManageThread}
				canMoveThread={canMoveThread}
				canDeleteThread={canDeleteThread}
				onReply={handleQuickReply}
			/>

			{/* Floating toolbar: scroll-to-top, prev/next page, back, jump-page, reply */}
			<FloatingToolbar
				prevHref={prevHref}
				nextHref={nextHref}
				backHref={backHref ?? `/forums/${thread.forumId}`}
				actionType={thread.closed !== 1 ? "reply" : "none"}
				onAction={handleQuickReply}
				jumpPage={jumpPage}
			/>

			{/* Reply Dialog */}
			<ReplyDialog
				open={replyOpen}
				onOpenChange={setReplyOpen}
				threadId={thread.id}
				threadSubject={thread.subject}
				quotedContent={quotedPost?.content}
				quotedAuthor={quotedPost?.author}
				quotedTime={quotedPost?.time}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// ThreadToolbar — reply button + mod menu, rendered before & after posts
// ---------------------------------------------------------------------------

function ThreadToolbar({
	thread,
	canManageThread,
	canMoveThread,
	canDeleteThread,
	onReply,
}: {
	thread: Thread;
	canManageThread: boolean;
	canMoveThread: boolean;
	canDeleteThread: boolean;
	onReply: () => void;
}) {
	const showReply = thread.closed !== 1;
	const showMod = canManageThread || canMoveThread || canDeleteThread;

	if (!showReply && !showMod) return null;

	return (
		<div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 -mt-px first:mt-0">
			{/* Reply button — traditional Discuz image */}
			{showReply ? (
				<button type="button" onClick={onReply} className="shrink-0">
					<img src={getStaticImageUrl("pn_reply.png")} alt="回复" className="block" />
				</button>
			) : (
				<div />
			)}

			{/* Thread mod menu */}
			{showMod && (
				<div className="min-w-0 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
					<ThreadModMenu
						threadId={thread.id}
						forumId={thread.forumId}
						sticky={thread.sticky}
						digest={thread.digest}
						highlight={thread.highlight}
						closed={thread.closed === 1}
						canManageThread={canManageThread}
						canMoveThread={canMoveThread}
						canDeleteThread={canDeleteThread}
					/>
				</div>
			)}
		</div>
	);
}
