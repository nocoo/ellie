// Ref: 04f §8 — Modern profile layout: hero + stats + tabbed content

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getAvatarUrl } from "@/lib/avatar";
import { buildUserBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import {
	PROFILE_TABS,
	formatBirthday,
	formatGender,
	formatLastActivity,
	formatLocation,
	formatOlTime,
	formatUserRole,
	getUserRoleBadgeVariant,
} from "@/viewmodels/forum/user-profile";
import { type UserProfileData, loadUserProfile } from "@/viewmodels/forum/user-profile.server";
import { getThreadBadges } from "@ellie/types";
import { UserRound } from "lucide-react";
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

	const activeData = data.tab === "threads" ? data.threads : data.posts;
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
							<AvatarFallback className="text-lg rounded-sm bg-[#F0F0F0]">
								<UserRound className="h-10 w-10 text-forum-text-muted" strokeWidth={1.2} />
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
			<div className="grid grid-cols-3 gap-4">
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
				</CardHeader>

				{/* Tab content */}
				<CardContent>
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
		</div>
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

// ---------------------------------------------------------------------------
// Personal info card — shows non-empty profile fields
// ---------------------------------------------------------------------------

function UserInfoCard({ user }: { user: UserProfileData["user"] }) {
	const gender = formatGender(user.gender);
	const birthday = formatBirthday(user.birthYear, user.birthMonth, user.birthDay);
	const location = formatLocation(user.resideProvince, user.resideCity);
	const olTime = formatOlTime(user.olTime);
	const lastActive = formatLastActivity(user.lastActivity);

	// Collect all info rows — only show card if at least one field has data
	const infoRows: { label: string; value: string }[] = [];
	if (gender) infoRows.push({ label: "性别", value: gender });
	if (birthday) infoRows.push({ label: "生日", value: birthday });
	if (location) infoRows.push({ label: "居住地", value: location });
	if (user.graduateSchool) infoRows.push({ label: "毕业学校", value: user.graduateSchool });
	if (user.qq) infoRows.push({ label: "QQ", value: user.qq });
	if (user.site) infoRows.push({ label: "个人网站", value: user.site });
	if (olTime) infoRows.push({ label: "在线时间", value: olTime });
	if (lastActive) infoRows.push({ label: "最后活动", value: lastActive });
	if (user.digestPosts > 0) infoRows.push({ label: "精华帖", value: String(user.digestPosts) });

	if (
		infoRows.length === 0 &&
		!user.bio &&
		!user.interest &&
		!user.groupTitle &&
		!user.customTitle
	) {
		return null;
	}

	return (
		<Card size="sm">
			<CardHeader className="border-b">
				<h2 className="text-sm font-medium text-foreground">个人信息</h2>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{/* Group title + custom title */}
					{(user.groupTitle || user.customTitle) && (
						<div className="flex items-center gap-2 flex-wrap text-sm">
							{user.groupTitle && (
								<Badge
									variant="outline"
									style={
										user.groupColor
											? { borderColor: user.groupColor, color: user.groupColor }
											: undefined
									}
								>
									{user.groupTitle}
									{user.groupStars > 0 && (
										<span className="ml-1 text-amber-500">
											{"★".repeat(Math.min(user.groupStars, 10))}
										</span>
									)}
								</Badge>
							)}
							{user.customTitle && (
								<span className="text-muted-foreground italic text-xs">{user.customTitle}</span>
							)}
						</div>
					)}

					{/* Info grid */}
					{infoRows.length > 0 && (
						<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
							{infoRows.map((row) => (
								<div key={row.label} className="flex items-baseline gap-2">
									<span className="text-muted-foreground text-xs shrink-0">{row.label}</span>
									{row.label === "个人网站" ? (
										<a
											href={row.value.startsWith("http") ? row.value : `https://${row.value}`}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline truncate text-xs"
										>
											{row.value}
										</a>
									) : (
										<span className="text-foreground truncate text-xs">{row.value}</span>
									)}
								</div>
							))}
						</div>
					)}

					{/* Bio */}
					{user.bio && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">个人简介</p>
							<p className="text-sm text-foreground">{user.bio}</p>
						</div>
					)}

					{/* Interest */}
					{user.interest && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">兴趣爱好</p>
							<p className="text-sm text-foreground">{user.interest}</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
