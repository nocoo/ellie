// post-sidebar-message-button.tsx — "发站内信" button with write-gate preflight
// Extracted from post-sidebar to keep the sidebar server-renderable while
// gating navigation behind writeGatePreflight.

"use client";

import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";

interface PostSidebarMessageButtonProps {
	userId: number;
}

export function PostSidebarMessageButton({ userId }: PostSidebarMessageButtonProps) {
	const router = useRouter();

	return (
		<button
			type="button"
			onClick={async () => {
				if (await writeGatePreflight(null, "message")) return;
				router.push(`/messages?to=${userId}`);
			}}
			className="flex items-center gap-1 text-xs text-forum-link hover:underline"
		>
			<Mail className="h-3.5 w-3.5" />
			发站内信
		</button>
	);
}
