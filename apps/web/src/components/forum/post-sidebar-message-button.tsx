// post-sidebar-message-button.tsx — "发站内信" button with write-gate preflight
// Opens ComposeMessageDialog in-place instead of navigating away,
// so the user stays on the current thread page.

"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";

interface PostSidebarMessageButtonProps {
	userId: number;
	username: string;
}

export function PostSidebarMessageButton({ userId, username }: PostSidebarMessageButtonProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={async () => {
					if (await writeGatePreflight(null, "message")) return;
					setOpen(true);
				}}
				className="flex items-center gap-1 text-xs text-forum-link hover:underline"
			>
				<Mail className="h-3.5 w-3.5" />
				发站内信
			</button>
			<ComposeMessageDialog
				open={open}
				onOpenChange={setOpen}
				initialRecipient={{ id: userId, username }}
			/>
		</>
	);
}
