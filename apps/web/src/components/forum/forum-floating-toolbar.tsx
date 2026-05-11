"use client";

// Client wrapper for forum list floating toolbar.
// Computes page-based prev/next hrefs, wires new-thread action
// with email verification preflight, and passes jump-page config.

import { FloatingToolbar } from "@/components/forum/floating-toolbar";
import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
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
}: ForumFloatingToolbarProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const prevHref = page > 1 ? (page === 2 ? basePath : `${basePath}?page=${page - 1}`) : null;
	const nextHref = page < pages ? `${basePath}?page=${page + 1}` : null;

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
				jumpPage={pages > 1 ? { basePath, pages } : undefined}
			/>
			{showNewThread && forumId != null && forumName && (
				<NewThreadDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					forumId={forumId}
					forumName={forumName}
				/>
			)}
		</>
	);
}
