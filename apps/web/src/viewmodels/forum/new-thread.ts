/**
 * New-thread page ViewModel — pure types & placeholder data.
 *
 * Defines the data contract for the Discuz-style "发表帖子" page.
 * Layout only — no real submission logic (see post-editor.ts for that).
 */

import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import type { Forum } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Post-type tab shown above the editor */
export interface PostTypeTab {
	value: string;
	label: string;
}

/** Extra option toggle below the editor */
export interface ExtraOption {
	value: string;
	label: string;
}

/** Group selector option for "来自群组" dropdown */
export interface GroupOption {
	value: string;
	label: string;
}

/** Editor toolbar action (auto-save status line) */
export interface EditorToolAction {
	label: string;
	/** Whether this is an actionable link (true) or plain text (false) */
	isAction: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POST_TYPE_TABS: PostTypeTab[] = [
	{ value: "thread", label: "发表帖子" },
	{ value: "poll", label: "发起投票" },
	{ value: "reward", label: "发布悬赏" },
	{ value: "debate", label: "发起辩论" },
	{ value: "event", label: "发起活动" },
];

export const EXTRA_OPTIONS: ExtraOption[] = [
	{ value: "extra", label: "附加选项" },
	{ value: "readPerm", label: "阅读权限" },
	{ value: "replyReward", label: "回帖奖励" },
	{ value: "rushThread", label: "抢楼主题" },
	{ value: "sellPrice", label: "主题售价" },
	{ value: "tags", label: "主题标签" },
];

export const GROUP_OPTIONS: GroupOption[] = [
	{ value: "", label: "选择我的群组" },
];

export const EDITOR_TOOL_ACTIONS: EditorToolAction[] = [
	{ label: "30 秒后保存", isAction: false },
	{ label: "保存数据", isAction: true },
	{ label: "恢复数据", isAction: true },
	{ label: "字数检查", isAction: true },
	{ label: "清除内容", isAction: true },
	{ label: "加大编辑框", isAction: true },
	{ label: "缩小编辑框", isAction: true },
];

/** Max characters for the thread subject */
export const SUBJECT_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------
// Breadcrumb builder
// ---------------------------------------------------------------------------

/**
 * Build breadcrumbs for the new-thread page.
 * → [首页, ...forum ancestors with href, current forum with href, 发表帖子]
 */
export function buildNewThreadBreadcrumbs(
	ancestors: Forum[],
): BreadcrumbItem[] {
	const HOME: BreadcrumbItem = { label: "首页", href: "/" };
	const items: BreadcrumbItem[] = [HOME];
	for (const forum of ancestors) {
		items.push({ label: forum.name, href: `/forums/${forum.id}` });
	}
	items.push({ label: "发表帖子" });
	return items;
}
