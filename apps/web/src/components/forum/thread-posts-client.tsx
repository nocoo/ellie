"use client";
import { FloatingActions } from "@/components/forum/floating-actions";
import { PostCard } from "@/components/forum/post-card";
import { ReplyDialog } from "@/components/forum/reply-dialog";
import { buildQuoteSnippet } from "@/lib/text";
import type { EnrichedPost } from "@/viewmodels/forum/thread-detail";
import { formatDateTime } from "@/viewmodels/shared/formatting";
import type { Thread } from "@ellie/types";
import { useCallback, useState } from "react";

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
	/** Previous page URL for pagination */
	prevHref?: string | null;
	/** Next page URL for pagination */
	nextHref?: string | null;
}

export function ThreadPostsClient({
	thread,
	posts,
	canModerateForum,
	canManageThread,
	canMoveThread,
	canDeleteThread,
	currentUserId,
	prevHref,
	nextHref,
}: ThreadPostsClientProps) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [quotedPost, setQuotedPost] = useState<{
		content: string;
		author: string;
		time: string;
	} | null>(null);

	const handleReply = useCallback((post?: EnrichedPost) => {
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
	}, []);

	const handleQuickReply = useCallback(() => {
		setQuotedPost(null);
		setReplyOpen(true);
	}, []);

	return (
		<>
			{/* Posts */}
			{posts.map((post) => {
				const isFirst = post.isFirst || post.position === 1;
				return (
					<PostCard
						key={post.id}
						post={post}
						threadViews={isFirst ? thread.views : undefined}
						threadReplies={isFirst ? thread.replies : undefined}
						threadDigest={isFirst ? thread.digest : undefined}
						threadSticky={isFirst ? thread.sticky : undefined}
						threadHighlight={isFirst ? thread.highlight : undefined}
						threadClosed={thread.closed === 1}
						onReply={() => handleReply(post)}
						canModerate={canModerateForum}
						canManageThread={canManageThread}
						canMoveThread={canMoveThread}
						canDeleteThread={canDeleteThread}
						currentUserId={currentUserId}
						isFirstPost={isFirst}
						threadId={thread.id}
						forumId={thread.forumId}
					/>
				);
			})}

			{/* Floating actions: scroll to top, reply button, keyboard hints */}
			<FloatingActions
				showReply={thread.closed !== 1}
				onReply={handleQuickReply}
				prevHref={prevHref}
				nextHref={nextHref}
				backHref={`/forums/${thread.forumId}`}
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
