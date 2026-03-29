import { PostCard } from "@/components/forum/post-card";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { type ThreadDetailData, loadThreadDetail } from "@/viewmodels/forum/thread-detail.server";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import { type Thread, getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface ThreadDetailPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ cursor?: string; direction?: string }>;
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

export default async function ThreadDetailPage({ params, searchParams }: ThreadDetailPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const threadId = Number.parseInt(id, 10);

	let data: ThreadDetailData;
	let error: string | null = null;

	try {
		data = await loadThreadDetail({
			threadId,
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load thread";
		data = {
			thread: null as unknown as Thread,
			posts: [],
			nextCursor: null,
			prevCursor: null,
			total: 0,
		};
	}

	if (error || !data.thread) {
		return (
			<div className="rounded-[14px] bg-card p-8 text-center">
				<p className="text-sm text-destructive">{error ?? "帖子不存在"}</p>
				<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
					返回首页
				</Link>
			</div>
		);
	}

	const badges = getThreadBadges(data.thread);

	return (
		<div className="space-y-4">
			{/* Thread header */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-center gap-2 flex-wrap">
					<ThreadBadgeList badges={badges} />
					<h1 className="text-lg font-semibold text-foreground">{data.thread.subject}</h1>
				</div>
				<div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
					<Link
						href={`/forums/${data.thread.forumId}`}
						className="hover:text-primary transition-colors"
					>
						版块
					</Link>
					<span>·</span>
					<Link
						href={`/users/${data.thread.authorId}`}
						className="hover:text-primary transition-colors"
					>
						{data.thread.authorName}
					</Link>
					<span>·</span>
					<span>{formatTime(data.thread.createdAt)}</span>
					<span>·</span>
					<span>{formatStat(data.thread.views)} 浏览</span>
					<span>·</span>
					<span>{formatStat(data.thread.replies)} 回复</span>
				</div>
			</div>

			{/* Posts */}
			<div className="space-y-3">
				{data.posts.map((post) => (
					<PostCard key={post.id} post={post} />
				))}
			</div>

			{data.posts.length === 0 && (
				<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
					暂无回复
				</div>
			)}

			{/* Keyset pagination */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground">共 {data.total} 条回复</span>
				<div className="flex items-center gap-2">
					<PageLink
						href={
							data.prevCursor
								? `/threads/${threadId}?cursor=${data.prevCursor}&direction=backward`
								: null
						}
						label="← 上一页"
						disabled={!data.prevCursor}
					/>
					<PageLink
						href={data.nextCursor ? `/threads/${threadId}?cursor=${data.nextCursor}` : null}
						label="下一页 →"
						disabled={!data.nextCursor}
					/>
				</div>
			</div>
		</div>
	);
}
