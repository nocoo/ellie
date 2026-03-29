// components/forum/top-bar.tsx — Forum top toolbar
// Ref: 04d §TopBar — login status / theme toggle

"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { LogIn, LogOut } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";

export function TopBar() {
	const { data: session } = useSession();

	const linkClass =
		"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

	return (
		<header className="flex h-10 items-center justify-end gap-2 border-b border-border bg-background px-4">
			{session?.user ? (
				<>
					<span className="text-sm text-muted-foreground">{session.user.name}</span>
					<Link href="/api/auth/signout" className={linkClass} aria-label="Sign out">
						<LogOut className="h-3.5 w-3.5" />
					</Link>
				</>
			) : (
				<Link href="/login" className={linkClass}>
					<LogIn className="h-3.5 w-3.5" />
					登录
				</Link>
			)}
			<ThemeToggle />
		</header>
	);
}
