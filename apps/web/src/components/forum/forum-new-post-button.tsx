"use client";

// components/forum/forum-new-post-button.tsx — Discuz pn_post.png button
// Opens the NewThreadDialog when clicked, with email verification preflight.

import { getStaticImageUrl } from "@/lib/cdn";
import { preflightEmailVerifiedBlock } from "@/viewmodels/forum/email-not-verified-dispatch";
import { useState } from "react";
import { NewThreadDialog } from "./new-thread-dialog";

interface ForumNewPostButtonProps {
	forumId: number;
	forumName: string;
	selfEmailVerifiedAt: number | null;
}

const postIconSrc = getStaticImageUrl("pn_post.png");

export function ForumNewPostButton({
	forumId,
	forumName,
	selfEmailVerifiedAt,
}: ForumNewPostButtonProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const handleClick = () => {
		if (preflightEmailVerifiedBlock(selfEmailVerifiedAt)) return;
		setDialogOpen(true);
	};

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
			/>
		</>
	);
}
