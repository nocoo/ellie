import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import type { ReactNode } from "react";

export default function ForumLayout({ children }: { children: ReactNode }) {
	return (
		<ForumLayoutShell>
			<SessionGuard />
			{children}
		</ForumLayoutShell>
	);
}
