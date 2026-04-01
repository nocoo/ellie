// Ref: 04f §8 — Modern profile layout: hero + stats + tabbed content

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { UserDigestTab } from "@/components/forum/user-digest-tab";
import { UserInfoCard } from "@/components/forum/user-info-card";
import { UserPostsTab } from "@/components/forum/user-posts-tab";
import { UserThreadsTab } from "@/components/forum/user-threads-tab";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { buildUserBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import {
	PROFILE_TABS,
	formatUserRole,
	getUserRoleBadgeVariant,
} from "@/viewmodels/forum/user-profile";
import { type UserProfileData, loadUserProfile } from "@/viewmodels/forum/user-profile.server";
import { getUserTitle } from "@/viewmodels/forum/title.server";
import { parseIntParam } from "@/viewmodels/shared/params";
import Link from "next/link";
import type { Metadata } from "next";

interface UserProfilePageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ tab?: string; cursor?: string; direction?: string }>;
}

export async function generateMetadata({ params }: UserProfilePageProps): Promise<Metadata> {
	const { id } = await params;
	const userId = parseIntParam(id);
	if (userId == null) return { title: "用户" };
	try {
		const username = await getUserTitle(userId);
		return { title: `${username}的个人资料` };
	} catch {
		return { title: "用户" };
	}
}

export default async function UserProfilePage({ params, searchParams }: UserProfilePageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const userId = parseIntParam(id);

	if (userId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的用户 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: UserProfileData;
	let error: string | null = null;

	try {
		data = await loadUserProfile({
			userId,
			tab: sp.tab,
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load user";
		data = null as unknown as UserProfileData;
	}

	if (error || !data) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "用户不存在"}</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	const activeData =
		data.tab === "threads" ? data.threads : data.tab === "posts" ? data.posts : data.digest;
	const breadcrumbs = buildUserBreadcrumbs(data.user.username);

	return (
		<div className="space-y-4">
			{/* Breadcrumbs */}
			<div className="py-2">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Hero: avatar + identity */}
			<Card size="sm">
				<CardContent>
					<div className="flex items-center gap-4">
						<Avatar className="h-16 w-16 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
							<AvatarImage
								src={getAvatarUrl(data.user.id, "middle")}
								alt={data.user.username}
								className="rounded-sm"
							/>
							<AvatarFallback className="text-lg rounded-sm bg-muted p-0 overflow-hidden">
								<img src={getStaticImageUrl("tavatar.gif")} alt="" className="h-full w-full object-cover" />
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 flex-wrap">
								<h1 className="text-xl font-semibold text-foreground">{data.user.username}</h1>
								<Badge variant={getUserRoleBadgeVariant(data.user.role)}>
									{formatUserRole(data.user.role)}
								</Badge>
							</div>
							<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<span>UID: {data.user.id}</span>
								<span>·</span>
								<span>注册于 {formatTime(data.user.regDate)}</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Stats */}
			<div className="grid grid-cols-4 gap-4">
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatStat(data.user.threads)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">主题数</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">{formatStat(data.user.posts)}</p>
						<p className="mt-1 text-xs text-muted-foreground">回帖数</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatStat(data.user.digestPosts)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">精华帖</p>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="text-center">
						<p className="text-2xl font-semibold text-foreground">
							{formatStat(data.user.credits)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">积分</p>
					</CardContent>
				</Card>
			</div>

			{/* Personal Info Card — only if any fields are non-empty */}
			<UserInfoCard user={data.user} />

			{/* Tabs + content */}
			<Card size="sm">
				{/* Tabs (Link-based for RSC) */}
				<CardHeader className="border-b">
					<div className="flex items-center gap-1">
						{PROFILE_TABS.map((t) => {
							const active = data.tab === t.key;
							// Show digest count in tab label if user has digest posts
							const label =
								t.key === "digest" && data.user.digestPosts > 0
									? `${t.label} (${data.user.digestPosts})`
									: t.label;
							return active ? (
								<span
									key={t.key}
									className="inline-flex h-8 items-center border-b-2 border-primary px-2 text-xs font-medium text-foreground"
								>
									{label}
								</span>
							) : (
								<Link
									key={t.key}
									href={`/users/${userId}?tab=${t.key}`}
									className="inline-flex h-8 items-center border-b-2 border-transparent px-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
								>
									{label}
								</Link>
							);
						})}
					</div>
				</CardHeader>

				{/* Tab content */}
				<CardContent>
					{data.tab === "threads" ? (
						<UserThreadsTab threads={data.threads} />
					) : data.tab === "posts" ? (
						<UserPostsTab posts={data.posts} />
					) : (
						<UserDigestTab digest={data.digest} />
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
		</div>
	);
}
