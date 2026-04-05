// components/forum/digest-showcase.tsx — Homepage digest threads showcase
// Shows recent digest threads with a link to full digest page

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { Thread } from "@ellie/types";
import { getThreadBadges } from "@ellie/types";
import { Award } from "lucide-react";
import Link from "next/link";

interface DigestShowcaseProps {
	threads: Thread[];
	total: number;
}

export function DigestShowcase({ threads, total }: DigestShowcaseProps) {
	// Empty state: show a friendly message instead of disappearing
	if (threads.length === 0) {
		return (
			<Card size="sm">
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex items-center gap-2">
						<Award className="h-5 w-5 text-muted-foreground" />
						<CardTitle className="text-base">精华推荐</CardTitle>
					</div>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground py-4 text-center">
						暂无精华帖子，优质内容将在这里展示
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card size="sm">
			<CardHeader className="flex flex-row items-center justify-between">
				<div className="flex items-center gap-2">
					<Award className="h-5 w-5 text-success" />
					<CardTitle className="text-base">精华推荐</CardTitle>
					<span className="text-xs text-muted-foreground">共 {total} 篇</span>
				</div>
				<Button
					size="sm"
					className="bg-success hover:bg-success/90 text-white gap-1.5"
					nativeButton={false}
					render={<Link href="/digest" />}
				>
					<Award className="h-4 w-4" />
					精华帖
				</Button>
			</CardHeader>

			<CardContent>
				<div className="divide-y divide-border/50">
					{threads.map((thread) => {
						// Only show digest badge in this showcase
						const badges = getThreadBadges(thread).filter((b) => b.type === "digest");
						return (
							<div
								key={thread.id}
								className="flex items-center gap-2 py-1.5 transition-colors hover:bg-accent/50"
							>
								{badges.length > 0 && <ThreadBadgeList badges={badges} />}
								<Link
									href={`/threads/${thread.id}`}
									className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
								>
									{thread.subject}
								</Link>
								<div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground shrink-0">
									<Link
										href={`/users/${thread.authorId}`}
										className="hover:text-primary transition-colors"
									>
										{thread.authorName}
									</Link>
									<span>·</span>
									<span>{formatRelativeTime(thread.createdAt)}</span>
								</div>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
