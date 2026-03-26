// components/layout/admin-layout.tsx — Admin shell: Sidebar + Header + Content
// Ref: 04c §AdminLayout — responsive sidebar behavior

"use client";

import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { AdminSidebar } from "./admin-sidebar";

export interface AdminLayoutProps {
	children: ReactNode;
	/** Page title displayed in header */
	title?: string;
	/** Current user info */
	user?: { username: string; avatar?: string | null };
}

export function AdminLayout({ children, title, user }: AdminLayoutProps) {
	const isMobile = useIsMobile();
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	// Auto-collapse on tablet
	useEffect(() => {
		if (!isMobile) {
			const isTablet = window.innerWidth <= 1024;
			setCollapsed(isTablet);
		}
	}, [isMobile]);

	const toggleSidebar = useCallback(() => {
		if (isMobile) {
			setMobileOpen((v) => !v);
		} else {
			setCollapsed((v) => !v);
		}
	}, [isMobile]);

	return (
		<div className="flex h-screen overflow-hidden bg-background">
			{/* Desktop/Tablet sidebar */}
			{!isMobile && <AdminSidebar collapsed={collapsed} onToggle={toggleSidebar} user={user} />}

			{/* Mobile sidebar overlay */}
			{isMobile && mobileOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay backdrop dismiss */}
					<div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
					<div className="fixed inset-y-0 left-0 z-50 w-[260px]">
						<AdminSidebar collapsed={false} onToggle={() => setMobileOpen(false)} user={user} />
					</div>
				</>
			)}

			{/* Main area */}
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* Header */}
				<header className="flex h-14 items-center gap-4 border-b border-border px-6">
					{isMobile && (
						<Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu">
							<Menu className="h-5 w-5" />
						</Button>
					)}
					{title && <h1 className="text-lg font-semibold">{title}</h1>}
				</header>

				{/* Content */}
				<main className={cn("flex-1 overflow-y-auto p-6")}>{children}</main>
			</div>
		</div>
	);
}
