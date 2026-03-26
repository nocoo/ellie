// components/layout/forum-navbar.tsx — Main forum navigation bar
// Ref: 04d §ForumNavbar — Logo + main navigation (Home/Forums/Digest/Search)

"use client";

import { cn } from "@/lib/utils";
import { BookOpen, Home, Menu, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";

export interface ForumNavItem {
	href: string;
	label: string;
	icon: typeof Home;
}

export const FORUM_NAV_ITEMS: ForumNavItem[] = [
	{ href: "/", label: "Home", icon: Home },
	{ href: "/digest", label: "Digest", icon: Sparkles },
	{ href: "/search", label: "Search", icon: Search },
];

/**
 * Determines if a nav item is active based on pathname.
 * Home only matches exact "/"; others match prefix.
 */
export function isNavActive(href: string, pathname: string): boolean {
	if (href === "/") return pathname === "/";
	return pathname.startsWith(href);
}

export function ForumNavbar() {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);

	return (
		<div className="h-14 border-b bg-background">
			<div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-4">
				{/* Logo */}
				<Link href="/" className="flex items-center gap-2">
					<BookOpen className="h-6 w-6 text-primary" />
					<span className="text-lg font-bold">Ellie</span>
				</Link>

				{/* Desktop nav */}
				<nav className="hidden items-center gap-1 md:flex">
					{FORUM_NAV_ITEMS.map((item) => {
						const active = isNavActive(item.href, pathname);
						return (
							<Link
								key={item.href}
								href={item.href}
								className={cn(
									"flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
									active
										? "bg-accent text-accent-foreground font-medium"
										: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
								)}
							>
								<item.icon className="h-4 w-4" />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</nav>

				{/* Mobile hamburger */}
				<Button
					variant="ghost"
					size="icon"
					className="md:hidden"
					aria-label="Open navigation"
					onClick={() => setMobileOpen(true)}
				>
					<Menu className="h-5 w-5" />
				</Button>
				<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
					<SheetContent side="left" className="w-64">
						<SheetHeader>
							<SheetTitle className="flex items-center gap-2">
								<BookOpen className="h-5 w-5 text-primary" />
								Ellie
							</SheetTitle>
						</SheetHeader>
						<nav className="mt-4 space-y-1">
							{FORUM_NAV_ITEMS.map((item) => {
								const active = isNavActive(item.href, pathname);
								return (
									<Link
										key={item.href}
										href={item.href}
										onClick={() => setMobileOpen(false)}
										className={cn(
											"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
											active
												? "bg-accent text-accent-foreground font-medium"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
									>
										<item.icon className="h-5 w-5" />
										<span>{item.label}</span>
									</Link>
								);
							})}
						</nav>
					</SheetContent>
				</Sheet>
			</div>
		</div>
	);
}
