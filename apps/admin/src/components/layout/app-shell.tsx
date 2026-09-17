"use client";

import { SITE_ART } from "@ellie/shared";
import {
	Button,
	ContentIsland,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	SheetTrigger,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
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
	const breadcrumbOverride = useBreadcrumbOverrideValue();
	const breadcrumbs = breadcrumbsFromPathname(pathname);
	const current = breadcrumbs.pop();

	// biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation or a breakpoint change
	useEffect(() => setMobileOpen(false), [pathname, isMobile]);

	return (
		<BasaltAppShell className="relative" data-area="admin">
			<AppSkipLink>跳到主要内容</AppSkipLink>
			<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
				{isMobile ? (
					<SheetContent side="left" className="w-[260px] max-w-[260px] gap-0 border-0 p-0">
						<SheetTitle className="sr-only">管理后台导航</SheetTitle>
						<SheetDescription className="sr-only">选择要管理的内容或设置。</SheetDescription>
						<Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} mobile />
					</SheetContent>
				) : (
					<Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
				)}
				<AppMain tabIndex={-1}>
					<AppHeader
						className="whitespace-nowrap [&_nav]:shrink-0"
						leading={
							isMobile ? (
								<SheetTrigger asChild>
									<Button variant="ghost" size="icon" className="h-8 w-8" aria-label="打开导航">
										<Menu aria-hidden="true" strokeWidth={1.5} />
									</Button>
								</SheetTrigger>
							) : null
						}
						breadcrumbs={breadcrumbs}
						title={breadcrumbOverride ?? current?.label}
						actions={<HeaderActions />}
					/>
					<div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
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
			</Sheet>
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
