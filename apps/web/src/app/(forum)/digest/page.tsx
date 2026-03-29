import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { type DigestData, loadDigestList } from "@/viewmodels/forum/digest.server";
import { formatStat, formatTime } from "@/viewmodels/forum/thread-list";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface DigestPageProps {
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

export default async function DigestPage({ searchParams }: DigestPageProps) {
	const sp = await searchParams;

	let data: DigestData;
	let error: string | null = null;

	try {
		data = await loadDigestList({
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "加载失败";
		data = null as unknown as DigestData;
	}

	if (error || !data) {
		return (
			<div className="rounded-[14px] bg-card p-8 text-center">
				<p className="text-sm text-destructive">{error ?? "加载出错"}</p>
				<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
					返回首页
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<h1 className="text-lg font-semibold text-foreground">精华帖</h1>

			{/* Thread list */}
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
						暂无精华帖
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
								? `/digest?cursor=${data.results.prevCursor}&direction=backward`
								: null
						}
						label="← 上一页"
						disabled={!data.results.prevCursor}
					/>
					<PageLink
						href={data.results.nextCursor ? `/digest?cursor=${data.results.nextCursor}` : null}
						label="下一页 →"
						disabled={!data.results.nextCursor}
					/>
				</div>
			</div>
		</div>
	);
}
