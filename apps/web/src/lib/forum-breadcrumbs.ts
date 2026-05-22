// lib/forum-breadcrumbs.ts — Server-side breadcrumb builders
// Pure functions, no React dependency.

import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import type { Forum } from "@ellie/types";
import type { AncestorItem } from "./forum-data";

const DEFAULT_HOME_LABEL = "同济网论坛";

function makeHome(label: string = DEFAULT_HOME_LABEL): BreadcrumbItem {
	return { label, href: "/", icon: "home" };
}

/** Map an array of {id, name} objects to linked breadcrumb items. */
function forumCrumbs(items: { id: number; name: string }[]): BreadcrumbItem[] {
	return items.map((f) => ({ label: f.name, href: `/forums/${f.id}` }));
}

/**
 * Build breadcrumbs for a forum page.
 * ancestors = [root, ..., parent, self] (from findForumAncestors).
 * → [首页, ...each ancestor with href, current forum without href]
 */
export function buildForumBreadcrumbs(ancestors: Forum[], homeLabel?: string): BreadcrumbItem[] {
	const home = makeHome(homeLabel);
	if (ancestors.length === 0) return [home];
	const last = ancestors[ancestors.length - 1] as Forum;
	return [home, ...forumCrumbs(ancestors.slice(0, -1)), { label: last.name }];
}

/**
 * Build breadcrumbs for a thread detail page.
 * ancestors = forum ancestor chain for thread.forumId.
 * → [首页, ...all forum ancestors with href, thread subject without href]
 */
export function buildThreadBreadcrumbs(
	ancestors: Forum[],
	subject: string,
	homeLabel?: string,
): BreadcrumbItem[] {
	return [makeHome(homeLabel), ...forumCrumbs(ancestors), { label: subject }];
}

/**
 * Build breadcrumbs for a user profile page.
 * → [首页, 用户, username]
 */
export function buildUserBreadcrumbs(username: string, homeLabel?: string): BreadcrumbItem[] {
	return [makeHome(homeLabel), { label: "用户" }, { label: username }];
}

// ─── Ancestors-endpoint breadcrumb builders ────────────────────────

/**
 * Build breadcrumbs from ancestors endpoint data + forum name.
 * ancestors = [root, ..., parent] (NOT including the target forum).
 * → [首页, ...ancestors with href, forumName without href]
 */
export function buildForumBreadcrumbsFromAncestors(
	ancestors: AncestorItem[],
	forumName: string,
	homeLabel?: string,
): BreadcrumbItem[] {
	return [makeHome(homeLabel), ...forumCrumbs(ancestors), { label: forumName }];
}

/**
 * Build breadcrumbs for thread detail from ancestors endpoint data.
 * ancestors = [root, ..., parent] (NOT including the target forum).
 * → [首页, ...ancestors with href, forumName with href, thread subject without href]
 */
export function buildThreadBreadcrumbsFromAncestors(
	ancestors: AncestorItem[],
	forumId: number,
	forumName: string,
	subject: string,
	homeLabel?: string,
): BreadcrumbItem[] {
	return [
		makeHome(homeLabel),
		...forumCrumbs(ancestors),
		{ label: forumName, href: `/forums/${forumId}` },
		{ label: subject },
	];
}

/**
 * Build breadcrumbs for new-thread page from ancestors endpoint data.
 * ancestors = [root, ..., parent] (NOT including the target forum).
 * → [首页, ...ancestors with href, forumName with href, 发表主题]
 */
export function buildNewThreadBreadcrumbsFromAncestors(
	ancestors: AncestorItem[],
	forumId: number,
	forumName: string,
	homeLabel?: string,
): BreadcrumbItem[] {
	return [
		makeHome(homeLabel),
		...forumCrumbs(ancestors),
		{ label: forumName, href: `/forums/${forumId}` },
		{ label: "发表主题" },
	];
}
