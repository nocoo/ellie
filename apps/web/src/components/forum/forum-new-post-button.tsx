"use client";

// components/forum/forum-new-post-button.tsx — Discuz pn_post.png button
// Opens the NewThreadDialog when clicked, with write-gate preflight.

import { getStaticImageUrl } from "@/lib/cdn";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { useCallback, useState } from "react";
import { NewThreadDialog } from "./new-thread-dialog";

interface ForumNewPostButtonProps {
	forumId: number;
	forumName: string;
	selfEmailVerifiedAt: number | null;
	/** Server-injected 主题分类 payload (null when feature off / load failed). */
	threadTypes?: ForumThreadTypesPublic | null;
}

const postIconSrc = getStaticImageUrl("pn_post.png");

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
			<button
				type="button"
				onClick={handleClick}
				className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
			>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={postIconSrc} alt="发表新帖" />
			</button>
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
