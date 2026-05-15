"use client";

// Client wrapper for forum list floating toolbar.
// Computes page-based prev/next hrefs, wires new-thread action
// with email verification preflight, and passes jump-page config.

import { FloatingToolbar } from "@/components/forum/floating-toolbar";
import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { useCallback, useState } from "react";

interface ForumFloatingToolbarProps {
	page: number;
	pages: number;
	basePath: string;
	backHref?: string;
	/** Forum ID for new thread dialog */
	forumId?: number;
	/** Forum name for new thread dialog */
	forumName?: string;
	/** Whether to show new-thread action (false for group forums or when no forumId) */
	showNewThread?: boolean;
	/** Server-side emailVerifiedAt for preflight check */
	selfEmailVerifiedAt?: number | null;
	/**
	 * Extra query params to preserve on prev/next/jump links — used by
	 * the 主题分类 filter to keep `?typeId=N` across page changes.
	 */
	extraParams?: Record<string, string>;
	/** Server-injected 主题分类 payload (null when feature off / load failed). */
	threadTypes?: ForumThreadTypesPublic | null;
}

export function ForumFloatingToolbar({
	page,
	pages,
	basePath,
	backHref = "/",
	forumId,
	forumName,
	showNewThread = false,
	selfEmailVerifiedAt = null,
	extraParams,
	threadTypes = null,
}: ForumFloatingToolbarProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const prevHref = page > 1 ? buildPageHref(basePath, page - 1, extraParams) : null;
	const nextHref = page < pages ? buildPageHref(basePath, page + 1, extraParams) : null;

	const handleNewThread = useCallback(async () => {
		if (await writeGatePreflight(selfEmailVerifiedAt, "thread")) return;
		setDialogOpen(true);
	}, [selfEmailVerifiedAt]);

	return (
		<>
			<FloatingToolbar
				prevHref={prevHref}
				nextHref={nextHref}
				backHref={backHref}
				actionType={showNewThread ? "new-thread" : "none"}
				onAction={showNewThread ? handleNewThread : undefined}
				jumpPage={pages > 1 ? { basePath, pages, extraParams } : undefined}
			/>
			{showNewThread && forumId != null && forumName && (
				<NewThreadDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					forumId={forumId}
					forumName={forumName}
					threadTypes={threadTypes}
				/>
			)}
		</>
	);
}

/**
 * Build a page link that preserves arbitrary extra query params (e.g.
 * `?typeId=N` from the 主题分类 filter).
 *
 * Page 1 is encoded as the bare `basePath` + extra params (no `?page=1`)
 * — matching the pagination convention used everywhere else on the
 * list page. We strip any existing query string off `basePath` first so
 * an upstream caller that passes a pre-built URL doesn't double-encode.
 */
function buildPageHref(
	basePath: string,
	page: number,
	extraParams: Record<string, string> | undefined,
): string {
	const [path, existingQs = ""] = basePath.split("?");
	const params = new URLSearchParams(existingQs);
	if (page > 1) params.set("page", String(page));
	else params.delete("page");
	if (extraParams) {
		for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
	}
	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}
