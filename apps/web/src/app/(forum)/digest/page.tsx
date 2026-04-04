// Ref: 04f §10 — Single Card: header + stats + thread rows + pagination

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { digestLabel } from "@/viewmodels/forum/digest";
import { type DigestData, loadDigestList } from "@/viewmodels/forum/digest.server";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import { getThreadBadges } from "@ellie/types";
import { Award } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "精华帖" };

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

	const breadcrumbs = [
		{ label: "首页", href: "/" },
		{ label: "精华帖", href: "/digest" },
	];

	return (
		<div className="space-y-4">
			<div className="py-2">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Stats cards */}
			<div className="grid grid-cols-4 gap-4">
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">{formatCompactNumber(data.stats.total)}</p>
						<p className="mt-1 text-xs text-muted-foreground">全部精华</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatCompactNumber(data.stats.level1)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">{digestLabel(1)}</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatCompactNumber(data.stats.level2)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">{digestLabel(2)}</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatCompactNumber(data.stats.level3)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">{digestLabel(3)}</p>
					</CardContent>
				</Card>
			</div>

			<Card size="sm">
				<CardHeader className="flex flex-row items-center gap-2">
					<Award className="h-5 w-5 text-success" />
					<CardTitle className="text-base">精华帖列表</CardTitle>
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
											<span>{formatRelativeTime(thread.lastPostAt ?? thread.createdAt)}</span>
										</div>
										<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
											<span>{formatCompactNumber(thread.views)} 览</span>
											<span>{formatCompactNumber(thread.replies)} 回</span>
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
		</div>
	);
}
