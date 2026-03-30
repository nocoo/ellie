// Ref: 04f §9 — Single Card: search form + type tabs + results + pagination

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SearchType } from "@/viewmodels/forum/search";
import { type SearchData, loadSearchResults } from "@/viewmodels/forum/search.server";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface SearchPageProps {
	searchParams: Promise<{ q?: string; type?: string; cursor?: string; direction?: string }>;
}

const SEARCH_TYPES: { key: SearchType; label: string }[] = [
	{ key: "title", label: "按标题搜索" },
	{ key: "author", label: "按作者搜索" },
];

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const sp = await searchParams;

	let data: SearchData;
	let error: string | null = null;

	try {
		data = await loadSearchResults({
			query: sp.q,
			type: sp.type,
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
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

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="text-base">搜索</CardTitle>
			</CardHeader>

			<CardContent className="space-y-3">
				{/* Search form */}
				<form className="flex gap-2" action="/search" method="get">
					<Input
						type="text"
						name="q"
						defaultValue={data.query}
						placeholder="搜索..."
						className="h-8 flex-1"
					/>
					<input type="hidden" name="type" value={data.searchType} />
					<Button type="submit" size="sm">
						搜索
					</Button>
				</form>

				{/* Search type tabs */}
				{data.query && (
					<div className="flex items-center gap-1 border-b">
						{SEARCH_TYPES.map((t) => {
							const active = data.searchType === t.key;
							return active ? (
								<span
									key={t.key}
									className="inline-flex h-7 items-center border-b-2 border-primary px-2 text-xs font-medium text-foreground"
								>
									{t.label}
								</span>
							) : (
								<Link
									key={t.key}
									href={`/search?q=${encodeURIComponent(data.query)}&type=${t.key}`}
									className="inline-flex h-7 items-center border-b-2 border-transparent px-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
								>
									{t.label}
								</Link>
							);
						})}
					</div>
				)}

				{/* Results */}
				{data.query ? (
					<>
						{data.results.items.length === 0 ? (
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
							totalLabel="条结果"
							prevHref={
								data.results.prevCursor
									? `/search?q=${encodeURIComponent(data.query)}&type=${data.searchType}&cursor=${data.results.prevCursor}&direction=backward`
									: null
							}
							nextHref={
								data.results.nextCursor
									? `/search?q=${encodeURIComponent(data.query)}&type=${data.searchType}&cursor=${data.results.nextCursor}`
									: null
							}
						/>
					</>
				) : (
					<div className="py-8 text-center text-sm text-muted-foreground">输入关键词开始搜索</div>
				)}
			</CardContent>
		</Card>
	);
}
