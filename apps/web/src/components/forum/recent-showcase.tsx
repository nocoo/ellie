import { HOME_DIGEST_LIMIT, type HomeRecentTopic } from "@ellie/types";
import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";

export function RecentShowcase({ threads }: { threads: HomeRecentTopic[] }) {
	return (
		<Card size="sm" className="min-w-0">
			<CardHeader className="flex flex-row items-center justify-between min-h-9">
				<div className="flex items-center gap-2">
					<MessageSquare className="size-5 text-primary" aria-hidden="true" />
					<CardTitle className="text-base">最近回复</CardTitle>
				</div>
				<span className="text-xs text-muted-foreground">最近 24 小时</span>
			</CardHeader>
			<CardContent>
				{threads.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						最近 24 小时暂无新帖或回复
					</p>
				) : (
					<div className="divide-y divide-border/50">
						{threads.slice(0, HOME_DIGEST_LIMIT).map((thread) => (
							<div key={thread.id} className="space-y-1 py-2.5">
								<Link
									href={`/threads/${thread.id}`}
									prefetch={false}
									className="block truncate text-sm text-foreground transition-colors hover:text-primary"
								>
									{thread.subject}
								</Link>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Link
										href={`/forums/${thread.forumId}`}
										prefetch={false}
										className="min-w-0 flex-1 truncate transition-colors hover:text-primary"
									>
										{thread.forumName}
									</Link>
									<span
										className="inline-flex shrink-0 items-center gap-1 tabular-nums"
										title="回复"
									>
										<MessageSquare className="size-3" aria-hidden="true" />
										{thread.replies}
									</span>
									<span className="shrink-0">{formatRelativeTime(thread.lastPostAt)}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
