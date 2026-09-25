import type { HomeDigestTopic } from "@ellie/types";
import { getThreadBadges, HOME_DIGEST_LIMIT } from "@ellie/types";
import { Award, Eye, MessageSquare } from "lucide-react";
import Link from "next/link";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";

interface DigestShowcaseProps {
	threads: HomeDigestTopic[];
}

export function DigestShowcase({ threads }: DigestShowcaseProps) {
	if (threads.length === 0) {
		return (
			<Card size="sm" className="min-w-0">
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex items-center gap-2">
						<Award className="h-5 w-5 text-muted-foreground" />
						<CardTitle className="text-base">精华推荐</CardTitle>
					</div>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground py-4 text-center">
						暂无精华主题，优质内容将在这里展示
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card size="sm" className="min-w-0">
			<CardHeader className="flex flex-row items-center justify-between">
				<div className="flex items-center gap-2">
					<Award className="h-5 w-5 text-success" />
					<CardTitle className="text-base">精华推荐</CardTitle>
				</div>
				<Button
					size="sm"
					variant="outline"
					className="gap-1.5"
					nativeButton={false}
					render={<Link href="/digest" prefetch={false} />}
				>
					<Award className="h-4 w-4" />
					精华帖
				</Button>
			</CardHeader>

			<CardContent>
				<div className="divide-y divide-border/50">
					{threads.slice(0, HOME_DIGEST_LIMIT).map((thread) => {
						const badges = getThreadBadges({
							digest: thread.digest,
							typeName: "",
							sticky: 0,
							closed: 0,
							special: 0,
						}).filter((b) => b.type === "digest");
						return (
							<div key={thread.id} className="space-y-1 py-2.5">
								<div className="flex items-center gap-2">
									{badges.length > 0 && <ThreadBadgeList badges={badges} />}
									<Link
										href={`/threads/${thread.id}`}
										prefetch={false}
										className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
									>
										{thread.subject}
									</Link>
								</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<div className="flex items-center gap-3 tabular-nums">
										<span className="inline-flex items-center gap-1" title="回复">
											<MessageSquare className="size-3" aria-hidden="true" />
											{thread.replies}
										</span>
										<span className="inline-flex items-center gap-1" title="查看">
											<Eye className="size-3" aria-hidden="true" />
											{thread.views}
										</span>
									</div>
									<div className="flex min-w-0 flex-1 items-center justify-end gap-2">
										{thread.authorId > 0 ? (
											<Link
												href={`/users/${thread.authorId}`}
												prefetch={false}
												className="truncate hover:text-primary transition-colors"
											>
												{thread.authorName}
											</Link>
										) : (
											<span>{thread.anonymousAuthor === 1 ? "匿名" : "未知用户"}</span>
										)}
										<span>·</span>
										<span className="shrink-0">{formatRelativeTime(thread.createdAt)}</span>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
