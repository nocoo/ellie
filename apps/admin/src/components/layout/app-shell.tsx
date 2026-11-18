"use client";

import { SITE_ART } from "@ellie/shared";
import { ContentIsland, SidebarDrawer, SidebarProvider } from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { usePathname } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { BreadcrumbOverrideProvider, useBreadcrumbOverrideValue } from "./breadcrumb-context";
import { HeaderActions } from "./header-actions";
import { Sidebar } from "./sidebar";

function AppShellInner({ children }: { children: ReactNode }) {
	const isMobile = useIsMobile();
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const pathname = usePathname();
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const drawerId = useId();
	const breadcrumbOverride = useBreadcrumbOverrideValue();
	const breadcrumbs = breadcrumbsFromPathname(pathname);
	const current = breadcrumbs.pop();

	// biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation or a breakpoint change
	useEffect(() => setMobileOpen(false), [pathname, isMobile]);

	return (
		<BasaltAppShell className="relative" data-area="admin">
			<AppSkipLink>跳到主要内容</AppSkipLink>
			{!isMobile && (
				<SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed}>
					<Sidebar />
				</SidebarProvider>
			)}
			<SidebarDrawer
				id={drawerId}
				open={mobileOpen}
				onOpenChange={setMobileOpen}
				returnFocusRef={menuButtonRef}
				title="管理后台导航"
				description="选择要管理的内容或设置。"
			>
				<Sidebar mobile onDismiss={() => setMobileOpen(false)} />
			</SidebarDrawer>
			<AppMain tabIndex={-1}>
				<AppHeader
					className="whitespace-nowrap [&_nav]:shrink-0"
					leading={
						isMobile ? (
							<AppHeaderMenuButton
								ref={menuButtonRef}
								label="打开导航"
								aria-controls={drawerId}
								aria-expanded={mobileOpen}
								onClick={() => setMobileOpen(true)}
							/>
						) : null
					}
					breadcrumbs={breadcrumbs}
					breadcrumbsLabel="面包屑导航"
					title={breadcrumbOverride ?? current?.label}
					actions={<HeaderActions />}
				/>
				<div className="flex min-h-0 flex-1 flex-col px-basalt-space-lg pb-basalt-space-lg md:px-basalt-layout-sm md:pb-basalt-layout-sm">
					<ContentIsland
						className="admin-campus relative isolate"
						style={
							{
								"--sketch-light": SITE_ART.admin.light.imageSet,
								"--sketch-dark": SITE_ART.admin.dark.imageSet,
							} as CSSProperties
						}
					>
						{children}
					</ContentIsland>
				</div>
			</AppMain>
		</BasaltAppShell>
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<BreadcrumbOverrideProvider>
			<AppShellInner>{children}</AppShellInner>
		</BreadcrumbOverrideProvider>
	);
}
