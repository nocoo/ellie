// Ref: 04f §8 — Card-wrapped profile header + Link-based tabs + empty state

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import {
	PROFILE_TABS,
	buildProfileStats,
	formatUserRole,
	formatUserStatus,
} from "@/viewmodels/forum/user-profile";
import { type UserProfileData, loadUserProfile } from "@/viewmodels/forum/user-profile.server";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface UserProfilePageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ tab?: string; cursor?: string; direction?: string }>;
}

export default async function UserProfilePage({ params, searchParams }: UserProfilePageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const userId = Number.parseInt(id, 10);

	let data: UserProfileData;
	let error: string | null = null;

	try {
		data = await loadUserProfile({
			userId,
			tab: sp.tab,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load user";
		data = null as unknown as UserProfileData;
	}

	if (error || !data) {
		return (
			<Card className="p-8 text-center">
				<p className="text-sm text-destructive">{error ?? "用户不存在"}</p>
				<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
					返回首页
				</Link>
			</Card>
		);
	}

	const stats = buildProfileStats(data.user);
	const activeData = data.tab === "threads" ? data.threads : data.posts;

	return (
		<Card>
			{/* Profile header */}
			<CardHeader className="pb-0">
				<div className="flex items-start gap-3">
					<Avatar className="h-12 w-12">
						<AvatarFallback className="text-sm">
							{data.user.username.slice(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 flex-wrap">
							<h1 className="text-base font-semibold text-foreground">{data.user.username}</h1>
							<span className="text-xs text-muted-foreground">
								{formatUserRole(data.user.role)} · {formatUserStatus(data.user.status)}
							</span>
						</div>
						<div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
							<span>注册: {formatTime(data.user.regDate)}</span>
							<span>·</span>
							<span>最后登录: {formatTime(data.user.lastLogin)}</span>
						</div>
						<div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
							<span>发帖 {formatStat(stats.threads)}</span>
							<span>·</span>
							<span>回帖 {formatStat(stats.posts)}</span>
							<span>·</span>
							<span>积分 {formatStat(stats.credits)}</span>
						</div>
					</div>
				</div>
			</CardHeader>

			{/* Tabs (Link-based for RSC) */}
			<div className="flex items-center gap-1 border-b px-4 mt-3">
				{PROFILE_TABS.map((t) => {
					const active = data.tab === t.key;
					return active ? (
						<span
							key={t.key}
							className="inline-flex h-8 items-center border-b-2 border-primary px-2 text-xs font-medium text-foreground"
						>
							{t.label}
						</span>
					) : (
						<Link
							key={t.key}
							href={`/users/${userId}?tab=${t.key}`}
							className="inline-flex h-8 items-center border-b-2 border-transparent px-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
						>
							{t.label}
						</Link>
					);
				})}
			</div>

			{/* Tab content */}
			<CardContent className="pt-3">
				{data.tab === "threads" ? (
					<ThreadsTab threads={data.threads} userId={userId} />
				) : (
					<PostsTab posts={data.posts} userId={userId} />
				)}

				{/* Pagination */}
				<KeysetPagination
					total={activeData.total}
					prevHref={
						activeData.prevCursor
							? `/users/${userId}?tab=${data.tab}&cursor=${activeData.prevCursor}&direction=backward`
							: null
					}
					nextHref={
						activeData.nextCursor
							? `/users/${userId}?tab=${data.tab}&cursor=${activeData.nextCursor}`
							: null
					}
				/>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ThreadsTab({
	threads,
	userId: _userId,
}: {
	threads: UserProfileData["threads"];
	userId: number;
}) {
	if (threads.items.length === 0) {
		return (
			<div className="py-8 text-center text-sm text-muted-foreground">
				暂无发帖（Worker v1 尚不支持按用户查询历史）
			</div>
		);
	}

	return (
		<div className="divide-y divide-border/50">
			{threads.items.map((thread) => {
				const badges = getThreadBadges(thread);
				return (
					<div key={thread.id} className="flex items-center gap-2 py-1.5">
						{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						<Link
							href={`/threads/${thread.id}`}
							className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
						>
							{thread.subject}
						</Link>
						<span className="text-xs text-muted-foreground shrink-0">
							{formatTime(thread.lastPostAt ?? thread.createdAt)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function PostsTab({
	posts,
	userId: _userId,
}: {
	posts: UserProfileData["posts"];
	userId: number;
}) {
	if (posts.items.length === 0) {
		return (
			<div className="py-8 text-center text-sm text-muted-foreground">
				暂无回复（Worker v1 尚不支持按用户查询历史）
			</div>
		);
	}

	return (
		<div className="divide-y divide-border/50">
			{posts.items.map((post) => (
				<div key={post.id} className="py-2">
					<Link
						href={`/threads/${post.threadId}`}
						className="text-xs text-muted-foreground hover:text-primary transition-colors"
					>
						回复帖子 #{post.threadId}
					</Link>
					<p className="mt-0.5 text-sm text-foreground line-clamp-2">
						{post.content.replace(/<[^>]*>/g, "").slice(0, 200)}
					</p>
					<span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>
				</div>
			))}
		</div>
	);
}
