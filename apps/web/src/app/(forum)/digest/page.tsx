// Ref: 04f §10 — Single Card: header + thread rows + pagination

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type DigestData, loadDigestList } from "@/viewmodels/forum/digest.server";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface DigestPageProps {
	searchParams: Promise<{ cursor?: string; direction?: string }>;
}

export default async function DigestPage({ searchParams }: DigestPageProps) {
	const sp = await searchParams;

	let data: DigestData;
	let error: string | null = null;

	try {
		data = await loadDigestList({
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "加载失败";
		data = null as unknown as DigestData;
	}

	if (error || !data) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "加载出错"}</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="text-base">精华帖</CardTitle>
			</CardHeader>

			<CardContent>
				{data.results.items.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">暂无精华帖</div>
				) : (
					<div className="divide-y divide-border/50">
						{data.results.items.map((thread) => {
							const badges = getThreadBadges(thread);
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
										<span>{formatTime(thread.lastPostAt ?? thread.createdAt)}</span>
									</div>
									<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
										<span>{formatStat(thread.views)} 览</span>
										<span>{formatStat(thread.replies)} 回</span>
									</div>
								</div>
							);
						})}
					</div>
				)}

				<KeysetPagination
					total={data.results.total}
					totalLabel="条精华"
					prevHref={
						data.results.prevCursor
							? `/digest?cursor=${data.results.prevCursor}&direction=backward`
							: null
					}
					nextHref={data.results.nextCursor ? `/digest?cursor=${data.results.nextCursor}` : null}
				/>
			</CardContent>
		</Card>
	);
}
