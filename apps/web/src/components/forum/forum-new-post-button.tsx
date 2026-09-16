"use client";

// components/forum/forum-new-post-button.tsx — Secondary new-thread action
// Opens the NewThreadDialog when clicked, with write-gate preflight.

import { PenLine } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { NewThreadDialog } from "./new-thread-dialog";

interface ForumNewPostButtonProps {
	forumId: number;
	forumName: string;
	selfEmailVerifiedAt: number | null;
	/** Server-injected 主题分类 payload (null when feature off / load failed). */
	threadTypes?: ForumThreadTypesPublic | null;
}

export function ForumNewPostButton({
	forumId,
	forumName,
	selfEmailVerifiedAt,
	threadTypes = null,
}: ForumNewPostButtonProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const handleClick = useCallback(async () => {
		if (await writeGatePreflight(selfEmailVerifiedAt, "thread")) return;
		setDialogOpen(true);
	}, [selfEmailVerifiedAt]);

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={handleClick}
				data-testid="forum-new-post-button"
				className="hidden shrink-0 sm:inline-flex"
			>
				<PenLine className="size-4" aria-hidden="true" />
				发表新帖
			</Button>
			<NewThreadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				forumId={forumId}
				forumName={forumName}
				threadTypes={threadTypes}
			/>
		</>
	);
}
