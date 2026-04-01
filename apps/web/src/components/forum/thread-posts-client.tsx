"use client";
import { PostCard } from "@/components/forum/post-card";
import { ReplyDialog } from "@/components/forum/reply-dialog";
import { Button } from "@/components/ui/button";
import type { EnrichedPost } from "@/viewmodels/forum/thread-detail";
import type { Thread } from "@ellie/types";
import { MessageSquarePlus } from "lucide-react";
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
}

export function ThreadPostsClient({
	thread,
	posts,
	canModerateForum,
	canManageThread,
	canMoveThread,
	canDeleteThread,
	currentUserId,
}: ThreadPostsClientProps) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [quotedPost, setQuotedPost] = useState<{
		content: string;
		author: string;
	} | null>(null);

	const handleReply = useCallback((post?: EnrichedPost) => {
		if (post) {
			// Quote reply - extract plain text for quote
			const plainText = post.content.replace(/<[^>]*>/g, "").slice(0, 200);
			setQuotedPost({
				content: plainText + (post.content.length > 200 ? "..." : ""),
				author: post.author?.username ?? "匿名",
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

			{/* Floating reply button (mobile-friendly quick reply) */}
			{!thread.closed && (
				<div className="fixed bottom-6 right-6 z-40">
					<Button
						onClick={handleQuickReply}
						size="lg"
						className="rounded-full h-14 w-14 p-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl hover:shadow-2xl transition-all duration-200 hover:scale-105"
					>
						<MessageSquarePlus className="h-6 w-6" />
						<span className="sr-only">快速回复</span>
					</Button>
				</div>
			)}

			{/* Reply Dialog */}
			<ReplyDialog
				open={replyOpen}
				onOpenChange={setReplyOpen}
				threadId={thread.id}
				threadSubject={thread.subject}
				quotedContent={quotedPost?.content}
				quotedAuthor={quotedPost?.author}
			/>
		</>
	);
}
