// Ref: 04f §8 — Modern profile layout: hero + stats + tabbed content

import { Award, Coins, MessageCircle, MessageSquare, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ProfileHero } from "@/components/forum/profile-hero";
import { UserDigestTab } from "@/components/forum/user-digest-tab";
import { UserInfoCard } from "@/components/forum/user-info-card";
import { UserPostsTab } from "@/components/forum/user-posts-tab";
import { UserThreadsTab } from "@/components/forum/user-threads-tab";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { buildUserBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import { getUserTitle } from "@/viewmodels/forum/title.server";
import { PROFILE_TABS } from "@/viewmodels/forum/user-profile";
import { loadUserProfile, type UserProfileData } from "@/viewmodels/forum/user-profile.server";
import { formatCompactNumber } from "@/viewmodels/shared/formatting";
import { parseIntParam } from "@/viewmodels/shared/params";

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
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildUserBreadcrumbs(data.user.username, homeLabel);
	const stats = [
		{
			label: "主题数",
			value: data.user.threads,
			icon: MessageSquare,
			href: `/users/${userId}?tab=threads`,
		},
		{
			label: "回复数",
			value: data.user.posts,
			icon: MessageCircle,
			href: `/users/${userId}?tab=posts`,
		},
		{
			label: "精华",
			value: data.user.digestPosts,
			icon: Award,
			href: `/users/${userId}?tab=digest`,
		},
		{ label: "积分", value: data.user.credits, icon: Sparkles },
		{ label: "同钱", value: data.user.coins ?? 0, icon: Coins },
	];

	return (
		<div className="space-y-4">
			{/* Breadcrumbs */}
			<div className="py-2">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Hero: avatar + identity + edit button */}
			<ProfileHero user={data.user} />

			<div className="grid grid-cols-5 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card">
				{stats.map(({ label, value, icon: Icon, href }) => {
					const content = (
						<>
							<Icon className="size-4 text-primary" aria-hidden="true" />
							<span className="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
								{formatCompactNumber(value)}
							</span>
							<span className="text-xs text-muted-foreground">{label}</span>
						</>
					);
					const className = "flex min-w-0 flex-col items-center gap-1.5 px-1 py-4";
					return href ? (
						<Link
							key={label}
							href={href}
							className={`${className} transition-colors hover:bg-accent`}
						>
							{content}
						</Link>
					) : (
						<div key={label} className={className}>
							{content}
						</div>
					);
				})}
			</div>

			{/* Personal Info Card — only if any fields are non-empty */}
			<UserInfoCard user={data.user} />

			{/* Tabs + content */}
			<Card className="rounded-2xl">
				{/* Tabs (Link-based for RSC) */}
				<CardHeader className="border-b">
					<nav aria-label="用户内容分类" className="flex flex-wrap items-center gap-1">
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
									className="inline-flex h-9 items-center rounded-lg bg-primary/10 px-3 text-sm font-semibold text-primary"
									aria-current="page"
									data-testid="user-profile-tab-active"
								>
									{label}
								</span>
							) : (
								<Link
									key={t.key}
									href={`/users/${userId}?tab=${t.key}`}
									className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
									data-testid="user-profile-tab-inactive"
								>
									{label}
								</Link>
							);
						})}
						<span className="ml-auto text-xs text-muted-foreground tabular-nums">
							共 {activeData.total} 条
						</span>
					</nav>
				</CardHeader>

				{/* Tab content */}
				<CardContent>
					{data.tab === "threads" ? (
						<UserThreadsTab threads={data.threads} forumsById={data.forumsById} />
					) : data.tab === "posts" ? (
						<UserPostsTab
							posts={data.posts}
							postsShape={data.postsShape}
							forumsById={data.forumsById}
						/>
					) : (
						<UserDigestTab digest={data.digest} forumsById={data.forumsById} />
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
