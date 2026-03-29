// components/forum/forum-layout.tsx — Forum layout shell
// Ref: 04d §布局 — TopBar + Navbar + Breadcrumbs + Content + Footer

"use client";

import type { ReactNode } from "react";
import { ForumBreadcrumbs } from "./forum-breadcrumbs";
import { ForumNavbar } from "./forum-navbar";
import { SiteFooter } from "./site-footer";
import { TopBar } from "./top-bar";

interface ForumLayoutShellProps {
	children: ReactNode;
}

export function ForumLayoutShell({ children }: ForumLayoutShellProps) {
	return (
		<div className="flex min-h-screen flex-col">
			<TopBar />
			<ForumNavbar />
			<ForumBreadcrumbs />
			<main className="flex-1">
				<div className="mx-auto max-w-[1200px] px-4 py-6">{children}</div>
			</main>
			<SiteFooter />
		</div>
	);
}
