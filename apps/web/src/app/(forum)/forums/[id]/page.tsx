// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

import { ForumFloatingActions } from "@/components/forum/forum-floating-actions";
import { ForumHeaderClient } from "@/components/forum/forum-header-client";
import { ForumPanel } from "@/components/forum/forum-panel";
import { PagePagination } from "@/components/forum/page-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import {
	type ThreadListPagedData,
	loadThreadListPaged,
} from "@/viewmodels/forum/thread-list.server";
import { getForumTitle } from "@/viewmodels/forum/title.server";
import { parseIntParam, parsePageParam } from "@/viewmodels/shared/params";
import { ForumType } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: ForumThreadsPageProps): Promise<Metadata> {
	const { id } = await params;
	const forumId = parseIntParam(id);
	if (forumId == null) return { title: "版块" };
	try {
		return { title: await getForumTitle(forumId) };
	} catch {
		return { title: "版块" };
	}
}

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = parseIntParam(id);
	const page = parsePageParam(sp.page);

	if (forumId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的版块 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: ThreadListPagedData;
	let error: string | null = null;

	try {
		data = await loadThreadListPaged({ forumId, page });
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = {
			forum: null,
			forums: [],
			items: [],
			page: 1,
			pages: 1,
			total: 0,
			limit: 100,
			breadcrumbs: [],
		};
	}

	const basePath = `/forums/${forumId}`;
	const isGroup = data.forum?.type === ForumType.Group;

	return (
		<div className="space-y-2">
			{/* Breadcrumbs */}
			{data.breadcrumbs.length > 1 && (
				<div className="py-2">
					<Breadcrumbs items={data.breadcrumbs} />
				</div>
			)}
			{/* Forum header with new thread button */}
			{data.forum && <ForumHeaderClient forum={data.forum} isGroup={isGroup} />}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{isGroup && data.forum ? (
				/* Group forum — render children as forum cards instead of thread list */
				<div className="overflow-hidden rounded-sm border border-border bg-card">
					<ForumPanel forums={data.forum.children} layout="auto" />
				</div>
			) : (
				/* Regular forum — thread list */
				<>
					{/* Sub-forums above thread list */}
					{data.forum && data.forum.children.length > 0 && (
						<div className="overflow-hidden rounded-sm border border-border bg-card">
							<ForumPanel forums={data.forum.children} layout="auto" />
						</div>
					)}

					<PagePagination
						page={data.page}
						pages={data.pages}
						total={data.total}
						basePath={basePath}
					/>

					<Card className="py-0">
						<CardContent className="p-0">
							<ThreadListHeader />

							{data.items.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">暂无帖子</div>
							) : (
								<div>
									{data.items.map((item) => (
										<ThreadItem key={item.thread.id} item={item} />
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<PagePagination
						page={data.page}
						pages={data.pages}
						total={data.total}
						basePath={basePath}
					/>

					{/* Floating actions with keyboard shortcuts */}
					<ForumFloatingActions page={data.page} pages={data.pages} basePath={basePath} />
				</>
			)}
		</div>
	);
}
