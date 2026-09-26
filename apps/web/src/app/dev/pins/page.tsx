import { StickyLevel, type Thread } from "@ellie/types";
import { notFound } from "next/navigation";
import { ThreadItem } from "@/components/forum/thread-item";
import { enrichThreads } from "@/viewmodels/forum/thread-list";

export default function PinPreviewPage() {
	if (process.env.NODE_ENV !== "development") notFound();
	const now = Math.floor(Date.now() / 1000);
	const threads: Thread[] = [
		{ sticky: StickyLevel.Forum, subject: "板块置顶 · 新生报到与版面使用指南" },
		{ sticky: StickyLevel.Category, subject: "分区置顶 · 校园生活分区活动汇总" },
		{ sticky: StickyLevel.Global, subject: "全局置顶 · 同济论坛站务公告" },
	].map((item, index) => ({
		id: index + 1,
		forumId: 1,
		authorId: 0,
		authorName: "匿名",
		authorAvatar: "",
		authorAvatarPath: "",
		createdAt: now - 3600,
		lastPostAt: now - 600,
		lastPoster: "匿名",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		replies: 12 + index * 8,
		views: 256 + index * 100,
		closed: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
		anonymousAuthor: 1,
		anonymousLastPoster: 1,
		isAuthorFirstThread: false,
		isRecommended: false,
		...item,
	}));
	return (
		<main className="mx-auto max-w-6xl p-6">
			<h1 className="mb-2 text-xl font-semibold">置顶图标预览</h1>
			<p className="mb-6 text-sm text-muted-foreground">
				三个模拟帖子 · 原尺寸 SVG · 调整窗口宽度可查看手机布局
			</p>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				{enrichThreads(threads).map((item) => (
					<ThreadItem key={item.thread.id} item={item} postsPerPage={20} />
				))}
			</div>
		</main>
	);
}
