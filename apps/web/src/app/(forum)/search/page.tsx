// Ref: 04f §9 — Single Card: search form + results + pagination

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { SearchHero } from "@/components/forum/search-hero";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type SearchData, loadSearchResults } from "@/viewmodels/forum/search.server";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import { getThreadBadges } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";

interface SearchPageProps {
	searchParams: Promise<{ q?: string; cursor?: string }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
	const sp = await searchParams;
	return { title: sp.q ? `搜索: ${sp.q}` : "搜索" };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const sp = await searchParams;

	let data: SearchData;
	let error: string | null = null;

	try {
		data = await loadSearchResults({
			query: sp.q,
			cursor: sp.cursor,
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "搜索失败";
		data = null as unknown as SearchData;
	}

	if (error || !data) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "搜索出错"}</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	// Search disabled by admin
	if (data.disabled) {
		return (
			<div className="space-y-4">
				<div className="py-2">
					<Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "搜索", href: "/search" }]} />
				</div>
				<SearchHero />
				<Card size="sm">
					<CardContent className="text-center py-8">
						<p className="text-sm text-muted-foreground">搜索功能暂时关闭</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const breadcrumbs = [
		{ label: "首页", href: "/" },
		{ label: "搜索", href: "/search" },
	];

	return (
		<div className="space-y-4">
			<div className="py-2">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Hero section */}
			<SearchHero />

			<Card size="sm">
				<CardHeader>
					<CardTitle className="text-base">搜索帖子</CardTitle>
				</CardHeader>

				<CardContent className="space-y-3">
					{/* Search form */}
					<form className="flex gap-2" action="/search" method="get">
						<Input
							type="text"
							name="q"
							defaultValue={data.query}
							placeholder="输入关键词搜索..."
							className="h-8 flex-1"
						/>
						<Button type="submit" size="sm">
							搜索
						</Button>
					</form>

					{/* Results */}
					{data.query ? (
						<>
							{data.query.length < 2 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">
									请输入至少 2 个字符
								</div>
							) : data.results.items.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">未找到相关结果</div>
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
													<span>{thread.authorName}</span>
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

							{data.results.items.length > 0 && (
								<KeysetPagination
									total={data.results.total}
									totalLabel="条结果"
									prevHref={null}
									nextHref={
										data.results.nextCursor
											? `/search?q=${encodeURIComponent(data.query)}&cursor=${data.results.nextCursor}`
											: null
									}
								/>
							)}
						</>
					) : (
						<div className="py-8 text-center text-sm text-muted-foreground">输入关键词开始搜索</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
