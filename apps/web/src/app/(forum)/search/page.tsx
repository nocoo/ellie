import { ThreadBadgeList } from "@/components/forum/thread-badge";
import type { SearchType } from "@/viewmodels/forum/search";
import { type SearchData, loadSearchResults } from "@/viewmodels/forum/search.server";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface SearchPageProps {
	searchParams: Promise<{ q?: string; type?: string; cursor?: string; direction?: string }>;
}

function SearchTypeLink({
	type,
	active,
	label,
	query,
}: {
	type: SearchType;
	active: boolean;
	label: string;
	query: string;
}) {
	const cls = active
		? "inline-flex h-8 items-center border-b-2 border-primary px-3 text-sm font-medium text-foreground"
		: "inline-flex h-8 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors";

	if (active) {
		return <span className={cls}>{label}</span>;
	}
	return (
		<Link href={`/search?q=${encodeURIComponent(query)}&type=${type}`} className={cls}>
			{label}
		</Link>
	);
}

function PageLink({
	href,
	label,
	disabled,
}: {
	href: string | null;
	label: string;
	disabled: boolean;
}) {
	const cls =
		"inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors";
	if (disabled || !href) {
		return (
			<span className={`${cls} text-muted-foreground opacity-50 cursor-not-allowed`}>{label}</span>
		);
	}
	return (
		<Link
			href={href}
			className={`${cls} text-muted-foreground hover:bg-muted hover:text-foreground`}
		>
			{label}
		</Link>
	);
}

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
			<div className="rounded-[14px] bg-card p-8 text-center">
				<p className="text-sm text-destructive">{error ?? "搜索出错"}</p>
				<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
					返回首页
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Search form */}
			<form className="flex gap-2" action="/search" method="get">
				<input
					type="text"
					name="q"
					defaultValue={data.query}
					placeholder="搜索..."
					className="h-9 flex-1 rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
				/>
				<input type="hidden" name="type" value={data.searchType} />
				<button
					type="submit"
					className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
				>
					搜索
				</button>
			</form>

			{/* Search type tabs */}
			{data.query && (
				<div className="flex border-b">
					<SearchTypeLink
						type="title"
						active={data.searchType === "title"}
						label="按标题搜索"
						query={data.query}
					/>
					<SearchTypeLink
						type="author"
						active={data.searchType === "author"}
						label="按作者搜索"
						query={data.query}
					/>
				</div>
			)}

			{/* Results */}
			{data.query ? (
				<>
					<p className="text-xs text-muted-foreground">
						共 {formatStat(data.results.total)} 条结果
					</p>
					<div className="space-y-2">
						{data.results.items.map((thread) => {
							const badges = getThreadBadges(thread);
							return (
								<div
									key={thread.id}
									className="flex items-center justify-between rounded-[10px] bg-secondary p-3"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											{badges.length > 0 && <ThreadBadgeList badges={badges} />}
											<Link
												href={`/threads/${thread.id}`}
												className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
											>
												{thread.subject}
											</Link>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{thread.authorName} · {formatTime(thread.lastPostAt ?? thread.createdAt)}
										</p>
									</div>
									<div className="shrink-0 ml-4 text-right text-xs text-muted-foreground">
										<p>{formatStat(thread.replies)} 回复</p>
										<p>{formatStat(thread.views)} 浏览</p>
									</div>
								</div>
							);
						})}
						{data.results.items.length === 0 && (
							<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
								未找到相关结果
							</div>
						)}
					</div>

					{/* Pagination */}
					<div className="flex items-center justify-between">
						<span className="text-xs text-muted-foreground">共 {data.results.total} 条</span>
						<div className="flex items-center gap-2">
							<PageLink
								href={
									data.results.prevCursor
										? `/search?q=${encodeURIComponent(data.query)}&type=${data.searchType}&cursor=${data.results.prevCursor}&direction=backward`
										: null
								}
								label="← 上一页"
								disabled={!data.results.prevCursor}
							/>
							<PageLink
								href={
									data.results.nextCursor
										? `/search?q=${encodeURIComponent(data.query)}&type=${data.searchType}&cursor=${data.results.nextCursor}`
										: null
								}
								label="下一页 →"
								disabled={!data.results.nextCursor}
							/>
						</div>
					</div>
				</>
			) : (
				<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
					输入关键词开始搜索
				</div>
			)}
		</div>
	);
}
