import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import { buildHeaderViewModel } from "@/viewmodels/forum/header";
import type { ReactNode } from "react";

export default function ForumLayout({ children }: { children: ReactNode }) {
	const headerVm = buildHeaderViewModel();
	const footerVm = buildGlobalFooterViewModel();

	return (
		<ForumLayoutShell headerVm={headerVm} footerVm={footerVm}>
			<SessionGuard />
			{children}
		</ForumLayoutShell>
	);
}
