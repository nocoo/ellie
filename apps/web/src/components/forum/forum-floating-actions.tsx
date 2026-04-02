"use client";

// Client wrapper for forum floating actions
// Provides keyboard shortcuts and scroll to top

import { FloatingActions } from "@/components/forum/floating-actions";

interface ForumFloatingActionsProps {
	page: number;
	pages: number;
	basePath: string;
	backHref?: string;
}

export function ForumFloatingActions({
	page,
	pages,
	basePath,
	backHref = "/",
}: ForumFloatingActionsProps) {
	const prevHref = page > 1 ? (page === 2 ? basePath : `${basePath}?page=${page - 1}`) : null;
	const nextHref = page < pages ? `${basePath}?page=${page + 1}` : null;

	return <FloatingActions prevHref={prevHref} nextHref={nextHref} backHref={backHref} />;
}
