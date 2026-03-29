// components/forum/forum-navbar.tsx — Main navigation bar
// Ref: 04d §ForumNavbar — Logo + nav links + mobile hamburger

"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { FORUM_NAV_ITEMS } from "@/lib/forum-navigation";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function NavLinks({ onClick }: { onClick?: () => void }) {
	const pathname = usePathname();

	return (
		<>
			{FORUM_NAV_ITEMS.map((item) => {
				const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

				return (
					<Link
						key={item.href}
						href={item.href}
						onClick={onClick}
						className={cn(
							"text-sm font-medium transition-colors hover:text-primary",
							isActive ? "text-primary" : "text-muted-foreground",
						)}
					>
						{item.label}
					</Link>
				);
			})}
		</>
	);
}

export function ForumNavbar() {
	const isMobile = useIsMobile();
	const [open, setOpen] = useState(false);

	return (
		<nav className="flex h-14 items-center border-b border-border bg-card px-4">
			<div className="mx-auto flex w-full max-w-[1200px] items-center justify-between">
				{/* Logo */}
				<Link href="/" className="flex items-center gap-2">
					<span className="text-xl font-bold font-display text-primary">Ellie</span>
				</Link>

				{/* Desktop nav */}
				{!isMobile && (
					<div className="flex items-center gap-6">
						<NavLinks />
					</div>
				)}

				{/* Mobile hamburger */}
				{isMobile && (
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
							<Menu className="h-5 w-5" />
						</SheetTrigger>
						<SheetContent side="right" className="w-64">
							<SheetTitle className="text-lg font-display font-bold text-primary">Ellie</SheetTitle>
							<nav className="mt-6 flex flex-col gap-4">
								<NavLinks onClick={() => setOpen(false)} />
							</nav>
						</SheetContent>
					</Sheet>
				)}
			</div>
		</nav>
	);
}
