// components/forum/forum-layout.tsx — Forum layout shell
// Ref: 04f §3 — classic Discuz multi-layer header + width-container + compact footer

"use client";

import type { ReactNode } from "react";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { ForumHeader } from "./forum-header";
import { SiteFooter } from "./site-footer";

interface ForumLayoutShellProps {
	headerVm: HeaderViewModel;
	footerVm: GlobalFooterViewModel;
	children: ReactNode;
}

export function ForumLayoutShell({ headerVm, footerVm, children }: ForumLayoutShellProps) {
	return (
		<div className="flex min-h-dvh flex-col bg-background" data-area="forum">
			{/* Skip link for keyboard users (WCAG 2.4.1) */}
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
			>
				跳转到主要内容
			</a>
			<ForumHeader vm={headerVm} />
			<main id="main-content" className="flex-1">
				<div className="width-container">
					<div className="py-4">{children}</div>
				</div>
			</main>
			<SiteFooter vm={footerVm} />
		</div>
	);
}
