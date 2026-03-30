// components/forum/forum-layout.tsx — Forum layout shell
// Ref: 04f §3 — single navbar + width-container + inline breadcrumbs + compact footer

"use client";

import type { ReactNode } from "react";
import { ForumBreadcrumbs } from "./forum-breadcrumbs";
import { ForumNavbar } from "./forum-navbar";
import { SiteFooter } from "./site-footer";

interface ForumLayoutShellProps {
	children: ReactNode;
}

export function ForumLayoutShell({ children }: ForumLayoutShellProps) {
	return (
		<div className="flex min-h-screen flex-col bg-background">
			<ForumNavbar />
			<main className="flex-1">
				<div className="width-container">
					<ForumBreadcrumbs />
					<div className="py-4">{children}</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
