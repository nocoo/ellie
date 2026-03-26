// components/layout/topbar.tsx — Forum top utility bar
// Ref: 04d §TopBar — Login status / quick links / theme toggle

"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/user-avatar";
import Link from "next/link";
import { Button } from "../ui/button";

export interface TopBarUser {
	username: string;
	avatar?: string | null;
}

export interface TopBarProps {
	user?: TopBarUser | null;
	onLogout?: () => void;
}

export function TopBar({ user, onLogout }: TopBarProps) {
	return (
		<div className="h-10 border-b bg-muted/30">
			<div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-4">
				{/* Left: user status */}
				<div className="flex items-center gap-2 text-sm">
					{user ? (
						<>
							<UserAvatar avatar={user.avatar} username={user.username} size="sm" />
							<span className="text-muted-foreground">{user.username}</span>
							<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onLogout}>
								Logout
							</Button>
						</>
					) : (
						<Link
							href="/login"
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							Login
						</Link>
					)}
				</div>

				{/* Right: theme toggle */}
				<ThemeToggle />
			</div>
		</div>
	);
}
