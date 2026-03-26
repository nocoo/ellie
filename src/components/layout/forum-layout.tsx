// components/layout/forum-layout.tsx — Forum layout shell
// Ref: 04d §ForumLayout — TopBar + Navbar + Breadcrumbs + Content + Footer

"use client";

import { type BreadcrumbItem, Breadcrumbs } from "@/components/breadcrumbs";
import type { ReactNode } from "react";
import { ForumNavbar } from "./forum-navbar";
import { SiteFooter } from "./site-footer";
import { TopBar, type TopBarUser } from "./topbar";

export interface ForumLayoutProps {
	children: ReactNode;
	/** Current user from session. Null = not logged in. */
	user?: TopBarUser | null;
	/** Breadcrumb trail. Empty array = no breadcrumbs shown. */
	breadcrumbs?: BreadcrumbItem[];
	/** Logout handler */
	onLogout?: () => void;
}

export function ForumLayout({ children, user, breadcrumbs = [], onLogout }: ForumLayoutProps) {
	return (
		<div className="flex min-h-screen flex-col">
			<TopBar user={user} onLogout={onLogout} />
			<ForumNavbar />

			{/* Breadcrumbs — only if items provided */}
			{breadcrumbs.length > 0 && (
				<div className="h-10 border-b">
					<div className="mx-auto flex h-full max-w-[1200px] items-center px-4">
						<Breadcrumbs items={breadcrumbs} />
					</div>
				</div>
			)}

			{/* Main content */}
			<main className="flex-1">
				<div className="mx-auto max-w-[1200px] px-4 py-6">{children}</div>
			</main>

			<SiteFooter />
		</div>
	);
}
