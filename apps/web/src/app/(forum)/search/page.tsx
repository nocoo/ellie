// Ref: 04f §9 — Single Card: search form + results + pagination

import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { SearchHero } from "@/components/forum/search-hero";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import { loadSearchResults, type SearchData } from "@/viewmodels/forum/search.server";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import { enrichThreads } from "@/viewmodels/forum/thread-list";

interface SearchPageProps {
	searchParams: Promise<{ q?: string; cursor?: string }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
	const sp = await searchParams;
	return { title: sp.q ? `搜索: ${sp.q}` : "搜索" };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const sp = await searchParams;
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");

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
					<Link
						prefetch={false}
						href="/"
						className="mt-4 inline-block text-sm text-primary hover:underline"
					>
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
					<Breadcrumbs
						items={[
							{ label: homeLabel, href: "/" },
							{ label: "搜索", href: "/search" },
						]}
					/>
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

	const postsPerPage = await getCachedPostsPerPage();
	const items = enrichThreads(data.results.items);
	const total = sp.cursor ? null : data.results.total;
	const countLabel = total === null ? "本页显示" : "找到";
	const breadcrumbs = [
		{ label: homeLabel, href: "/" },
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
					<CardTitle className="text-base">搜索主题</CardTitle>
				</CardHeader>

				<CardContent className="space-y-3">
					{/* Search form */}
					<form className="flex gap-2" action="/search" method="get">
						<Input
							type="search"
							aria-label="关键词"
							name="q"
							defaultValue={data.query}
							placeholder="输入关键词搜索..."
							className="h-10 flex-1"
						/>
						<Button type="submit" className="h-10 px-4">
							<Search className="size-4" aria-hidden="true" />
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
								<div className="overflow-hidden rounded-xl border border-border">
									<div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
										{countLabel}{" "}
										<strong className="font-semibold text-foreground">
											{total ?? items.length}
										</strong>{" "}
										条相关主题
									</div>
									<ThreadListHeader />
									{items.map((item) => (
										<ThreadItem key={item.thread.id} item={item} postsPerPage={postsPerPage} />
									))}
								</div>
							)}

							{data.results.items.length > 0 && (
								<KeysetPagination
									total={total}
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
