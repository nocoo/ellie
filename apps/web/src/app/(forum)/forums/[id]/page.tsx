import { type ThreadSort, sortLabel } from "@/viewmodels/forum/thread-list";
import { type ThreadListData, loadThreadList } from "@/viewmodels/forum/thread-list.server";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ sort?: string; digest?: string; cursor?: string }>;
}

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = Number.parseInt(id, 10);

	let data: ThreadListData;
	let error: string | null = null;

	try {
		data = await loadThreadList({
			forumId,
			sort: (sp.sort as ThreadSort) || "latest",
			digestOnly: sp.digest === "1",
			cursor: sp.cursor,
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = { forum: null, items: [], nextCursor: null, prevCursor: null, total: 0 };
	}

	return (
		<div className="space-y-6">
			{/* Forum header */}
			{data.forum && (
				<div className="rounded-[14px] bg-card p-6">
					<h1 className="text-xl font-semibold text-foreground">{data.forum.name}</h1>
					{data.forum.description && (
						<p className="mt-1 text-sm text-muted-foreground">{data.forum.description}</p>
					)}
					<div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
						<span>帖子 {data.forum.threads.toLocaleString()}</span>
						<span>回帖 {data.forum.posts.toLocaleString()}</span>
					</div>
				</div>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{/* Placeholder: thread list with sort/filter UI */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-center justify-between gap-2 mb-4">
					<div className="flex items-center gap-1 text-sm">
						<span className="font-medium text-muted-foreground">排序:</span>
						{(["latest", "newest", "hot"] as const).map((s) => (
							<span
								key={s}
								className={`px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
									(sp.sort as ThreadSort) === s || (!sp.sort && s === "latest")
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								{sortLabel(s)}
							</span>
						))}
					</div>
				</div>

				{data.items.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">暂无帖子</div>
				) : (
					<div className="space-y-2">
						{data.items.map((item) => (
							<a
								key={item.thread.id}
								href={`/threads/${item.thread.id}`}
								className="block rounded-lg bg-secondary p-3 transition-colors hover:bg-accent"
							>
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-foreground">{item.thread.subject}</span>
								</div>
								<div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
									<span>{item.thread.authorName}</span>
									<span>·</span>
									<span>{item.thread.replies} 回复</span>
									<span>·</span>
									<span>{item.thread.views} 浏览</span>
								</div>
							</a>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
