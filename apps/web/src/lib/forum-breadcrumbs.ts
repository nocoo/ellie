// lib/forum-breadcrumbs.ts — Server-side breadcrumb builders
// Pure functions, no React dependency.

import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import type { Forum } from "@ellie/types";
import type { AncestorItem } from "./forum-data";

const HOME: BreadcrumbItem = { label: "同济网论坛", href: "/", icon: "home" };

/**
 * Build breadcrumbs for a forum page.
 * ancestors = [root, ..., parent, self] (from findForumAncestors).
 * → [首页, ...each ancestor with href, current forum without href]
 */
export function buildForumBreadcrumbs(ancestors: Forum[]): BreadcrumbItem[] {
	if (ancestors.length === 0) return [HOME];

	const items: BreadcrumbItem[] = [HOME];
	for (let i = 0; i < ancestors.length; i++) {
		const forum = ancestors[i] as Forum;
		const isLast = i === ancestors.length - 1;
		items.push(isLast ? { label: forum.name } : { label: forum.name, href: `/forums/${forum.id}` });
	}
	return items;
}

/**
 * Build breadcrumbs for a thread detail page.
 * ancestors = forum ancestor chain for thread.forumId.
 * → [首页, ...all forum ancestors with href, thread subject without href]
 */
export function buildThreadBreadcrumbs(ancestors: Forum[], subject: string): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [HOME];
	for (const forum of ancestors) {
		items.push({ label: forum.name, href: `/forums/${forum.id}` });
	}
	items.push({ label: subject });
	return items;
}

/**
 * Build breadcrumbs for a user profile page.
 * → [首页, 用户, username]
 */
export function buildUserBreadcrumbs(username: string): BreadcrumbItem[] {
	return [HOME, { label: "用户" }, { label: username }];
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
): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [HOME];
	for (const a of ancestors) {
		items.push({ label: a.name, href: `/forums/${a.id}` });
	}
	items.push({ label: forumName });
	return items;
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
): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [HOME];
	for (const a of ancestors) {
		items.push({ label: a.name, href: `/forums/${a.id}` });
	}
	items.push({ label: forumName, href: `/forums/${forumId}` });
	items.push({ label: subject });
	return items;
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
): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [HOME];
	for (const a of ancestors) {
		items.push({ label: a.name, href: `/forums/${a.id}` });
	}
	items.push({ label: forumName, href: `/forums/${forumId}` });
	items.push({ label: "发表主题" });
	return items;
}
