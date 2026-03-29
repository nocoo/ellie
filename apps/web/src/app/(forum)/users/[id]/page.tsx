import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import {
	PROFILE_TABS,
	type ProfileTab,
	buildProfileStats,
	formatUserRole,
	formatUserStatus,
} from "@/viewmodels/forum/user-profile";
import { type UserProfileData, loadUserProfile } from "@/viewmodels/forum/user-profile.server";
import Link from "next/link";

interface UserProfilePageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ tab?: string; cursor?: string; direction?: string }>;
}

function TabLink({
	userId,
	tab,
	active,
	label,
	cursor,
}: {
	userId: number;
	tab: ProfileTab;
	active: boolean;
	label: string;
	cursor?: string;
}) {
	const cls = active
		? "inline-flex h-8 items-center border-b-2 border-primary px-3 text-sm font-medium text-foreground"
		: "inline-flex h-8 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors";

	if (active) {
		return <span className={cls}>{label}</span>;
	}
	return (
		<Link href={`/users/${userId}?tab=${tab}${cursor ? `&cursor=${cursor}` : ""}`} className={cls}>
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
			<div className="rounded-[14px] bg-card p-8 text-center">
				<p className="text-sm text-destructive">{error ?? "用户不存在"}</p>
				<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
					返回首页
				</Link>
			</div>
		);
	}

	const stats = buildProfileStats(data.user);

	// Pick the active tab data
	const activeData = data.tab === "threads" ? data.threads : data.posts;

	return (
		<div className="space-y-4">
			{/* User profile card */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-start gap-4">
					<Avatar className="h-16 w-16">
						<AvatarFallback className="text-lg">
							{data.user.username.slice(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<h1 className="text-lg font-semibold text-foreground">{data.user.username}</h1>
						<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
							<span>{formatUserRole(data.user.role)}</span>
							<span>·</span>
							<span>{formatUserStatus(data.user.status)}</span>
						</div>
						<div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
							<span>注册: {formatTime(data.user.regDate)}</span>
							<span>·</span>
							<span>最后登录: {formatTime(data.user.lastLogin)}</span>
						</div>
						<div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
							<span>发帖 {formatStat(stats.threads)}</span>
							<span>·</span>
							<span>回帖 {formatStat(stats.posts)}</span>
							<span>·</span>
							<span>积分 {formatStat(stats.credits)}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex border-b">
				{PROFILE_TABS.map((t) => (
					<TabLink
						key={t.key}
						userId={userId}
						tab={t.key}
						active={data.tab === t.key}
						label={t.label}
					/>
				))}
			</div>

			{/* Tab content */}
			{data.tab === "threads" ? (
				<div className="space-y-2">
					{data.threads.items.map((thread) => (
						<div
							key={thread.id}
							className="flex items-center justify-between rounded-[10px] bg-secondary p-3"
						>
							<Link
								href={`/threads/${thread.id}`}
								className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
							>
								{thread.subject}
							</Link>
							<span className="text-xs text-muted-foreground shrink-0 ml-4">
								{formatTime(thread.lastPostAt ?? thread.createdAt)}
							</span>
						</div>
					))}
					{data.threads.items.length === 0 && (
						<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
							暂无发帖
						</div>
					)}
				</div>
			) : (
				<div className="space-y-2">
					{data.posts.items.map((post) => (
						<div key={post.id} className="rounded-[10px] bg-secondary p-3">
							<Link
								href={`/threads/${post.threadId}`}
								className="text-xs text-muted-foreground hover:text-primary transition-colors"
							>
								回复帖子 #{post.threadId}
							</Link>
							<p className="mt-1 text-sm text-foreground line-clamp-2">
								{post.content.replace(/<[^>]*>/g, "").slice(0, 200)}
							</p>
							<span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>
						</div>
					))}
					{data.posts.items.length === 0 && (
						<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
							暂无回复
						</div>
					)}
				</div>
			)}

			{/* Pagination */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground">共 {activeData.total} 条</span>
				<div className="flex items-center gap-2">
					<PageLink
						href={
							activeData.prevCursor
								? `/users/${userId}?tab=${data.tab}&cursor=${activeData.prevCursor}&direction=backward`
								: null
						}
						label="← 上一页"
						disabled={!activeData.prevCursor}
					/>
					<PageLink
						href={
							activeData.nextCursor
								? `/users/${userId}?tab=${data.tab}&cursor=${activeData.nextCursor}`
								: null
						}
						label="下一页 →"
						disabled={!activeData.nextCursor}
					/>
				</div>
			</div>
		</div>
	);
}
