// components/forum/forum-navbar.tsx — Combined navigation bar
// Ref: 04f §3 — merged TopBar + ForumNavbar into single h-12 bar
// Logo + nav links + auth status + WidthToggle + ThemeToggle + mobile hamburger

"use client";

import { ForumLogo } from "@/components/forum/forum-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WidthToggle } from "@/components/width-toggle";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { FORUM_NAV_ITEMS } from "@/lib/forum-navigation";
import { cn } from "@/lib/utils";
import { LogIn, LogOut, Menu } from "lucide-react";
import { useSession } from "next-auth/react";
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

function AuthControls({ className }: { className?: string }) {
	const { data: session } = useSession();

	const linkClass =
		"inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground";

	return (
		<div className={cn("flex items-center gap-1", className)}>
			{session?.user ? (
				<>
					<span className="text-xs text-muted-foreground truncate max-w-[100px]">
						{session.user.name}
					</span>
					<Link href="/api/auth/signout" className={linkClass} aria-label="Sign out">
						<LogOut className="h-3.5 w-3.5" />
					</Link>
				</>
			) : (
				<Link href="/login" className={linkClass}>
					<LogIn className="h-3.5 w-3.5" />
					<span className="text-xs">登录</span>
				</Link>
			)}
		</div>
	);
}

interface ForumNavbarProps {
	logoLight?: string;
	logoDark?: string;
	logoAlt?: string;
}

export function ForumNavbar({ logoLight, logoDark, logoAlt }: ForumNavbarProps = {}) {
	const isMobile = useIsMobile();
	const [open, setOpen] = useState(false);

	return (
		<nav className="sticky top-0 z-40 flex h-12 items-center border-b border-border bg-card">
			<div className="width-container flex w-full items-center justify-between !py-0">
				{/* Left: Logo + nav links */}
				<div className="flex items-center gap-6">
					<Link href="/" className="flex items-center gap-2">
						<ForumLogo height={24} lightSrc={logoLight} darkSrc={logoDark} alt={logoAlt} />
					</Link>

					{/* Desktop nav */}
					{!isMobile && (
						<div className="flex items-center gap-5">
							<NavLinks />
						</div>
					)}
				</div>

				{/* Right: auth + toggles */}
				{!isMobile ? (
					<div className="flex items-center gap-1">
						<AuthControls />
						<WidthToggle />
						<ThemeToggle />
					</div>
				) : (
					<div className="flex items-center gap-1">
						<Sheet open={open} onOpenChange={setOpen}>
							<SheetTrigger
								render={<Button variant="ghost" size="icon-sm" aria-label="Open menu" />}
							>
								<Menu className="h-5 w-5" />
							</SheetTrigger>
							<SheetContent side="right" className="w-64">
								<SheetTitle className="flex items-center">
									<ForumLogo height={24} lightSrc={logoLight} darkSrc={logoDark} alt={logoAlt} />
								</SheetTitle>
								<nav className="mt-6 flex flex-col gap-4">
									<NavLinks onClick={() => setOpen(false)} />
								</nav>
								<div className="mt-6 flex flex-col gap-3">
									<AuthControls />
									<div className="flex items-center gap-1">
										<WidthToggle />
										<ThemeToggle />
									</div>
								</div>
							</SheetContent>
						</Sheet>
					</div>
				)}
			</div>
		</nav>
	);
}
