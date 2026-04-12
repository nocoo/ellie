// data/mock/posts.ts — Mock post data
// Ref: 04a §Post interface

import type { Post } from "@ellie/types";

export const MOCK_POSTS: Post[] = [
	// Thread 50001 — 招生简章
	{
		id: 100001,
		threadId: 50001,
		forumId: 10,
		authorId: 1,
		authorName: "admin",
		content:
			'<p>2024年同济大学招生简章已正式发布，欢迎各位考生关注。</p><p>详细信息请访问 <a href="https://bkzs.tongji.edu.cn">招生网</a>。</p>',
		createdAt: 1711526400,
		isFirst: true,
		position: 1,
	},
	{
		id: 100002,
		threadId: 50001,
		forumId: 10,
		authorId: 10,
		authorName: "zhangsan",
		content: "<p>感谢分享！请问今年计算机专业招多少人？</p>",
		createdAt: 1711530000,
		isFirst: false,
		position: 2,
	},
	{
		id: 100003,
		threadId: 50001,
		forumId: 10,
		authorId: 1,
		authorName: "admin",
		content: "<p>具体名额以最终公布为准，去年是120人左右。</p>",
		createdAt: 1711533600,
		isFirst: false,
		position: 3,
	},

	// Thread 50002 — 高数复习
	{
		id: 100010,
		threadId: 50002,
		forumId: 11,
		authorId: 11,
		authorName: "lisi",
		content:
			'<p>整理了高等数学的期末复习资料，包含往年真题和解析。</p><p>附件在下方，请自行下载。</p><attachment data-aid="1001"></attachment>',
		createdAt: 1711353600,
		isFirst: true,
		position: 1,
	},
	{
		id: 100011,
		threadId: 50002,
		forumId: 11,
		authorId: 10,
		authorName: "zhangsan",
		content: "<p>太感谢了！正好需要这个资料。</p>",
		createdAt: 1711357200,
		isFirst: false,
		position: 2,
	},

	// Thread 50010 — TypeScript
	{
		id: 100020,
		threadId: 50010,
		forumId: 20,
		authorId: 3,
		authorName: "mod_tech",
		content:
			"<p>TypeScript 5.9 带来了很多令人兴奋的新特性：</p><ul><li>改进的类型推断</li><li>更好的性能</li><li>新的装饰器语法</li></ul>",
		createdAt: 1711526400,
		isFirst: true,
		position: 1,
	},
	{
		id: 100021,
		threadId: 50010,
		forumId: 20,
		authorId: 10,
		authorName: "zhangsan",
		content: "<p>新的类型推断确实很强大，项目中已经在用了。</p>",
		createdAt: 1711530000,
		isFirst: false,
		position: 2,
	},

	// Thread 50012 — React help
	{
		id: 100030,
		threadId: 50012,
		forumId: 20,
		authorId: 10,
		authorName: "zhangsan",
		content:
			"<p>请问 React 19 的 useTransition 和 startTransition 有什么区别？在什么场景下使用比较好？</p>",
		createdAt: 1711180800,
		isFirst: true,
		position: 1,
	},
	{
		id: 100031,
		threadId: 50012,
		forumId: 20,
		authorId: 3,
		authorName: "mod_tech",
		content:
			"<p>useTransition 返回 isPending 状态，适合需要 loading 指示的场景。startTransition 是轻量版，不需要 isPending 时使用。</p>",
		createdAt: 1711184400,
		isFirst: false,
		position: 2,
	},
];
