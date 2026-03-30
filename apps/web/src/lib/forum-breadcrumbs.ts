// lib/forum-breadcrumbs.ts — Server-side breadcrumb builders
// Pure functions, no React dependency.

import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import type { Forum } from "@ellie/types";

const HOME: BreadcrumbItem = { label: "首页", href: "/" };

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
