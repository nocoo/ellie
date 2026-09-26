import {
	type ForumTreeNode,
	ForumType,
	getThreadBadges,
	StickyLevel,
	type Thread,
} from "@ellie/types";
import { notFound } from "next/navigation";
import { DigestCard } from "@/components/forum/digest-card";
import { DigestShowcase } from "@/components/forum/digest-showcase";
import { ForumCard } from "@/components/forum/forum-card";
import { ThreadItem } from "@/components/forum/thread-item";
import { enrichThreads } from "@/viewmodels/forum/thread-list";

export default function PinPreviewPage() {
	if (process.env.NODE_ENV !== "development") notFound();
	const now = Math.floor(Date.now() / 1000);
	const threads: Thread[] = [
		{ sticky: StickyLevel.Forum, subject: "板块置顶 · 新生报到与版面使用指南" },
		{ sticky: StickyLevel.Category, subject: "分区置顶 · 校园生活分区活动汇总" },
		{ sticky: StickyLevel.Global, subject: "全局置顶 · 同济论坛站务公告" },
		{
			sticky: StickyLevel.None,
			subject: "普通主题 · 校园生活随手记",
			createdAt: now - 172800,
			lastPostAt: now - 172800,
			replies: 5,
		},
		{ sticky: StickyLevel.None, subject: "活跃主题 · 24 小时内有新帖或回复", replies: 8 },
		{ sticky: StickyLevel.None, subject: "锁定主题 · 本次讨论已结束", closed: 1, replies: 80 },
		{ sticky: StickyLevel.None, subject: "热门主题 · 回复已超过三页", replies: 61 },
		{ sticky: StickyLevel.None, subject: "投票 · 选出你最喜欢的校园角落", special: 1 },
		{ sticky: StickyLevel.None, subject: "悬赏 · 求解一道数学题", special: 3 },
		{ sticky: StickyLevel.None, subject: "辩论 · 课堂上是否应该使用电脑", special: 5 },
		{ sticky: StickyLevel.None, subject: "活动 · 周末校园摄影小聚", special: 4 },
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
	const digestThreads = [1, 2, 3].map((digest) => ({
		...threads[3],
		id: 100 + digest,
		anonymousAuthor: 1 as const,
		digest,
		subject: `${digest} 级精华 · 社区精选内容`,
	}));
	const forums: ForumTreeNode[] = [true, false].map((active, index) => ({
		id: index + 1,
		parentId: 0,
		name: active ? "校园生活 · 近期有新主题" : "学习交流 · 近期无新主题",
		description: "论坛首页图标预览",
		announcement: "",
		icon: "",
		displayOrder: index,
		threads: 1234,
		posts: 5678,
		type: ForumType.Forum,
		status: 1,
		visibility: "public",
		moderators: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: index + 1,
		lastPostAt: now - (active ? 3600 : 172800),
		lastPoster: "预览用户",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: active ? "一小时前发布的新主题" : "两天前发布的主题",
		threadTypes: { enabled: false, required: false, listable: false, prefix: false },
		children: [],
	}));
	return (
		<main className="mx-auto max-w-6xl p-6">
			<h1 className="mb-2 text-xl font-semibold">主题图标预览</h1>
			<p className="mb-6 text-sm text-muted-foreground">
				置顶与文件夹状态 · 原尺寸 SVG · 调整窗口宽度可查看手机布局
			</p>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				{enrichThreads(threads).map((item) => (
					<ThreadItem key={item.thread.id} item={item} postsPerPage={20} />
				))}
			</div>
			<h2 className="mb-3 mt-8 text-xl font-semibold">论坛首页图标预览</h2>
			<div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
				{forums.map((forum) => (
					<ForumCard key={forum.id} forum={forum} />
				))}
			</div>
			<h2 className="mb-3 mt-8 text-xl font-semibold">首页精华推荐</h2>
			<DigestShowcase threads={digestThreads} />
			<h2 className="mb-3 mt-8 text-xl font-semibold">精华页列表</h2>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				{digestThreads.map((thread) => (
					<DigestCard key={thread.id} thread={thread} badges={getThreadBadges(thread)} />
				))}
			</div>
		</main>
	);
}
