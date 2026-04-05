// Ref: 04f §10 — Digest page: hero + tabs filter + card list + pagination

import { DigestCard } from "@/components/forum/digest-card";
import { DigestHero } from "@/components/forum/digest-hero";
import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { digestLabel } from "@/viewmodels/forum/digest";
import { type DigestData, loadDigestList } from "@/viewmodels/forum/digest.server";
import { getThreadBadges } from "@ellie/types";
import { Award } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "精华帖" };

/** Filter tab link component mimicking shadcn tabs visual style */
function FilterTab({
	href,
	active,
	children,
}: {
	href: string;
	active: boolean;
	children: React.ReactNode;
}) {
	return (
		<Link
			href={href}
			className={cn(
				"relative px-2 py-1.5 text-sm font-medium transition-colors",
				"hover:text-foreground",
				active
					? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground"
					: "text-muted-foreground",
			)}
		>
			{children}
		</Link>
	);
}

interface DigestPageProps {
	searchParams: Promise<{ cursor?: string; direction?: string; level?: string }>;
}

export default async function DigestPage({ searchParams }: DigestPageProps) {
	const sp = await searchParams;

	// Parse level filter (0 = all, 1/2/3 = specific level)
	const level = sp.level ? Number.parseInt(sp.level, 10) : 0;
	const validLevel = level >= 1 && level <= 3 ? level : undefined;

	let data: DigestData;
	let error: string | null = null;

	try {
		data = await loadDigestList({
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
			level: validLevel,
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

	// Build pagination URLs with level preserved
	const buildUrl = (cursor: string, direction?: string) => {
		const params = new URLSearchParams();
		params.set("cursor", cursor);
		if (direction) params.set("direction", direction);
		if (validLevel) params.set("level", String(validLevel));
		return `/digest?${params.toString()}`;
	};

	return (
		<div className="space-y-4">
			<div className="py-2">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Hero section */}
			<DigestHero stats={data.stats} />

			{/* Tabs filter + thread list */}
			<Card size="sm">
				<CardHeader className="flex flex-row items-center gap-2 border-b">
					<Award className="h-5 w-5 text-success" />
					<CardTitle className="text-base flex-1">精华帖列表</CardTitle>
				</CardHeader>

				<CardContent className="pt-3">
					{/* Filter tabs (server-rendered links) */}
					<div className="flex items-center gap-1 mb-4 border-b border-border pb-px">
						<FilterTab href="/digest" active={!validLevel}>
							全部 ({data.stats.total})
						</FilterTab>
						<FilterTab href="/digest?level=1" active={validLevel === 1}>
							{digestLabel(1)} ({data.stats.level1})
						</FilterTab>
						<FilterTab href="/digest?level=2" active={validLevel === 2}>
							{digestLabel(2)} ({data.stats.level2})
						</FilterTab>
						<FilterTab href="/digest?level=3" active={validLevel === 3}>
							{digestLabel(3)} ({data.stats.level3})
						</FilterTab>
					</div>

					{/* Thread list */}
					{data.results.items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">暂无精华帖</div>
					) : (
						<div className="space-y-2">
							{data.results.items.map((thread) => {
								const badges = getThreadBadges(thread);
								return <DigestCard key={thread.id} thread={thread} badges={badges} />;
							})}
						</div>
					)}

					<KeysetPagination
						total={data.results.total}
						totalLabel="条精华"
						prevHref={
							data.results.prevCursor ? buildUrl(data.results.prevCursor, "backward") : null
						}
						nextHref={data.results.nextCursor ? buildUrl(data.results.nextCursor) : null}
						className="mt-4 flex items-center justify-between py-2"
					/>
				</CardContent>
			</Card>
		</div>
	);
}
