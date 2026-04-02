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
			<div className="rounded-sm border border-border bg-card p-4">
				{/* Top: Forum name + New thread button */}
				<div className="flex items-center justify-between gap-4">
					<h1 className="text-lg font-semibold text-foreground">{forum.name}</h1>
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

				{/* Description */}
				{forum.description && (
					<SafeHtml
						html={forum.description}
						className="mt-2 text-sm text-muted-foreground leading-relaxed"
					/>
				)}

				{/* Stats row */}
				{!isGroup && (
					<div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-6 text-sm">
						<span className="text-muted-foreground">
							帖子{" "}
							<span className="font-medium text-foreground">{formatNumber(forum.threads)}</span>
						</span>
						<span className="text-muted-foreground">
							回帖 <span className="font-medium text-foreground">{formatNumber(forum.posts)}</span>
						</span>
						<Link
							href="/digest"
							className="text-success hover:text-success/80 transition-colors font-medium"
						>
							精华帖
						</Link>
					</div>
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
