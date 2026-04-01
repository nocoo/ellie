/**
 * Messages page ViewModel — pure types & placeholder data.
 *
 * Defines the data contract for the Discuz-style 站内消息 (PM/notification) page.
 * Two-column layout: notification sidebar + message list.
 * All numeric placeholders use 777.
 */

import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Left sidebar menu item */
export interface NotifMenuItem {
	value: string;
	label: string;
	icon: "mail" | "file-text" | "users" | "bell" | "wrench" | "grid";
	/** Badge count — undefined means no badge */
	badge?: number;
}

/** Tab in the message content area header */
export interface MessageTab {
	value: string;
	label: string;
	/** Whether this tab renders as a primary action button instead of a tab */
	isAction?: boolean;
}

/** Direction of a message — who sent to whom */
export type MessageDirection = "incoming" | "outgoing";

/** A single message item in the list */
export interface MessageItem {
	id: number;
	/** The other party's username (not the current user) */
	peerUsername: string;
	/** The other party's UID */
	peerUid: number;
	/** incoming = "peerName 对 您 说", outgoing = "您 对 peerName 说" */
	direction: MessageDirection;
	/** Preview/snippet of the message body */
	preview: string;
	/** ISO timestamp string */
	date: string;
	/** Total messages in this conversation */
	totalMessages: number;
	/** Whether this message/conversation is unread */
	unread: boolean;
}

/** Aggregated data for the messages page */
export interface MessagesPageViewModel {
	sidebarItems: NotifMenuItem[];
	tabs: MessageTab[];
	unreadCount: number;
	messages: MessageItem[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NOTIF_SIDEBAR_ITEMS: NotifMenuItem[] = [
	{ value: "messages", label: "消息", icon: "mail", badge: 2 },
	{ value: "my-posts", label: "我的帖子", icon: "file-text" },
	{ value: "friends", label: "坛友互动", icon: "users", badge: 1 },
	{ value: "system", label: "系统提醒", icon: "bell" },
	{ value: "admin", label: "管理工作", icon: "wrench", badge: 1 },
	{ value: "apps", label: "应用提醒", icon: "grid" },
];

export const MESSAGE_TABS: MessageTab[] = [
	{ value: "private", label: "私人消息" },
	{ value: "public", label: "公共消息" },
	{ value: "send", label: "发送消息", isAction: true },
];

// ---------------------------------------------------------------------------
// Placeholder messages — all numbers → 777
// ---------------------------------------------------------------------------

export const PLACEHOLDER_MESSAGES: MessageItem[] = [
	{
		id: 1,
		peerUsername: "jungwoo",
		peerUid: 777,
		direction: "incoming",
		preview:
			'关于您在"求帮助，@tongji.asia不能收发邮件"的帖子 不好意思再次打扰。这几天突然发现，这个邮箱再次出现了问题。问题如下：We are sorry, but your Administrator ... ...',
		date: "2022-10-26 22:35",
		totalMessages: 1,
		unread: true,
	},
	{
		id: 2,
		peerUsername: "cabbage224",
		peerUid: 777,
		direction: "incoming",
		preview:
			'关于您在"很早以前申请的tongji.asia邮箱还能用么"的帖子 hi, 今天发现tongji.asia 邮箱无法进入了，提示：Your organisation\'s Google Workspace account has bee ...',
		date: "2022-9-19 12:26",
		totalMessages: 1,
		unread: true,
	},
	{
		id: 3,
		peerUsername: "xiubujiang",
		peerUid: 777,
		direction: "incoming",
		preview:
			'关于您在"很早以前申请的tongji.asia邮箱还能用么"的帖子 你好，我08年申请的tongji.aisa的邮箱，留学申请用过一段时间，后来好久没用了，最近想进去进不去了，地址输入 ... ...',
		date: "2017-4-11 10:03",
		totalMessages: 1,
		unread: false,
	},
	{
		id: 4,
		peerUsername: "阿平",
		peerUid: 777,
		direction: "incoming",
		preview:
			"我自己想弄一个专业方面的门户网站，想找人来做网站建设方面的工作，不知道你自己是否有空或者帮我推荐其他人？网站类型类似于http://www.chinabim.com/nbsp; nbsp;h ... ...",
		date: "2016-6-13 13:13",
		totalMessages: 3,
		unread: false,
	},
	{
		id: 5,
		peerUsername: "Johnstone",
		peerUid: 777,
		direction: "incoming",
		preview: "版务，为啥现在.net注册不了新账号，换了三个邮箱都收不到认证邮件。",
		date: "2016-1-20 13:55",
		totalMessages: 1,
		unread: false,
	},
	{
		id: 6,
		peerUsername: "也伤",
		peerUid: 777,
		direction: "incoming",
		preview: "谢谢，修复了就好了，太感谢了，心情大好",
		date: "2014-6-13 10:35",
		totalMessages: 2,
		unread: false,
	},
	{
		id: 7,
		peerUsername: "beibeiking",
		peerUid: 777,
		direction: "incoming",
		preview:
			'关于您在"【06老废柴】跳槽求教 — 一点补充"的帖子 方便加QQ聊吗？还有一些职业规划方面的事情想请教你。谢谢 QQ：1073891593 ...',
		date: "2013-11-2 10:18",
		totalMessages: 7,
		unread: false,
	},
	{
		id: 8,
		peerUsername: "lukaikai",
		peerUid: 777,
		direction: "outgoing",
		preview: "密码已经重置成：tj123456!",
		date: "2013-5-21 05:58",
		totalMessages: 2,
		unread: false,
	},
	{
		id: 9,
		peerUsername: "kopite",
		peerUid: 777,
		direction: "outgoing",
		preview: "悬赏最高值和评分限制都改了。",
		date: "2013-5-10 08:20",
		totalMessages: 1,
		unread: false,
	},
];

// ---------------------------------------------------------------------------
// Build view model
// ---------------------------------------------------------------------------

export function buildMessagesPageViewModel(): MessagesPageViewModel {
	return {
		sidebarItems: NOTIF_SIDEBAR_ITEMS,
		tabs: MESSAGE_TABS,
		unreadCount: 2,
		messages: PLACEHOLDER_MESSAGES,
	};
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export function buildMessagesBreadcrumbs(): BreadcrumbItem[] {
	return [{ label: "首页", href: "/" }, { label: "通知", href: "/messages" }, { label: "消息" }];
}
