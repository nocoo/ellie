// components/forum/forum-layout.tsx — Forum layout shell
// Ref: 04f §3 — classic Discuz multi-layer header + width-container + compact footer

"use client";

import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import type { ReactNode } from "react";
import { ForumHeader } from "./forum-header";
import { SiteFooter } from "./site-footer";

interface ForumLayoutShellProps {
	headerVm: HeaderViewModel;
	footerVm: GlobalFooterViewModel;
	children: ReactNode;
}

export function ForumLayoutShell({ headerVm, footerVm, children }: ForumLayoutShellProps) {
	return (
		<div className="flex min-h-screen flex-col bg-background">
			<ForumHeader vm={headerVm} />
			<main className="flex-1">
				<div className="width-container">
					<div className="py-4">{children}</div>
				</div>
			</main>
			<SiteFooter vm={footerVm} />
		</div>
	);
}
