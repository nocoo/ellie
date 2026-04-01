"use client";

// Client wrapper for forum page header with new thread button
// Manages new thread dialog state

import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
import { SafeHtml } from "@/components/forum/safe-html";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { Forum } from "@ellie/types";
import { PenLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface ForumHeaderClientProps {
	forum: Forum;
	isGroup: boolean;
}

export function ForumHeaderClient({ forum, isGroup }: ForumHeaderClientProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<h1 className="text-lg font-semibold">{forum.name}</h1>
					<div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
						{forum.description && <SafeHtml html={forum.description} />}
						{!isGroup && (
							<>
								<span>帖子 {formatNumber(forum.threads)}</span>
								<span>回帖 {formatNumber(forum.posts)}</span>
								<Link
									href="/digest"
									className="text-success hover:text-success/80 transition-colors"
								>
									精华帖
								</Link>
							</>
						)}
					</div>
				</div>

				{/* New thread button - only for regular forums, not groups */}
				{!isGroup && (
					<Button
						onClick={() => setDialogOpen(true)}
						className="shrink-0 gap-2 bg-primary hover:bg-primary/90"
					>
						<PenLine className="h-4 w-4" />
						发表新帖
					</Button>
				)}
			</div>

			{/* New Thread Dialog */}
			<NewThreadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				forumId={forum.id}
				forumName={forum.name}
			/>
		</>
	);
}
