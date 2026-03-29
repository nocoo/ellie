"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BreadcrumbOverrideProvider, useBreadcrumbOverrideValue } from "./breadcrumb-context";
import { Breadcrumbs } from "./breadcrumbs";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

interface AppShellProps {
	children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
	const isMobile = useIsMobile();
	const { mobileOpen, setMobileOpen } = useSidebar();
	const pathname = usePathname();

	// Close mobile sidebar on route change
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger
	useEffect(() => {
		setMobileOpen(false);
	}, [pathname, setMobileOpen]);

	// Prevent body scroll when mobile sidebar is open
	useEffect(() => {
		if (mobileOpen) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [mobileOpen]);

	const breadcrumbs = breadcrumbsFromPathname(pathname);
	const breadcrumbOverride = useBreadcrumbOverrideValue();

	// If a page sets a dynamic breadcrumb override, replace the last segment's label
	if (breadcrumbOverride && breadcrumbs.length > 0) {
		const last = breadcrumbs[breadcrumbs.length - 1];
		breadcrumbs[breadcrumbs.length - 1] = { ...last, label: breadcrumbOverride };
	}

	return (
		<div className="flex min-h-screen w-full bg-background">
			{/* Desktop sidebar */}
			{!isMobile && <Sidebar />}

			{/* Mobile overlay */}
			{isMobile && mobileOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss overlay */}
					<div
						className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
						onClick={() => setMobileOpen(false)}
					/>
					<div className="fixed inset-y-0 left-0 z-50 w-[260px]">
						<Sidebar />
					</div>
				</>
			)}

			<main className="flex flex-1 flex-col min-h-screen min-w-0">
				{/* Header */}
				<header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
					<div className="flex items-center gap-3">
						{isMobile && (
							<button
								type="button"
								onClick={() => setMobileOpen(true)}
								aria-label="Open navigation"
								className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							>
								<Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
							</button>
						)}
						<Breadcrumbs items={breadcrumbs} />
					</div>
					<div className="flex items-center gap-1">
						<ThemeToggle />
					</div>
				</header>

				{/* Floating island content area */}
				<div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
					<div className="h-full rounded-[16px] md:rounded-[20px] bg-card p-3 md:p-5 overflow-y-auto">
						{children}
					</div>
				</div>
			</main>
		</div>
	);
}

export function AppShell({ children }: AppShellProps) {
	return (
		<SidebarProvider>
			<BreadcrumbOverrideProvider>
				<AppShellInner>{children}</AppShellInner>
			</BreadcrumbOverrideProvider>
		</SidebarProvider>
	);
}
