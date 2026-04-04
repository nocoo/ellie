// MessageBadgeIcon — Mail icon with unread count badge for header
// Only fetches unread count for credentials users (who have Worker JWT)

"use client";

import { cn } from "@/lib/utils";
import { fetchUnreadCount } from "@/viewmodels/forum/messages";
import { Mail } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Refresh interval for polling unread count
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MessageBadgeIcon() {
	const { data: session, status } = useSession();
	const [unreadCount, setUnreadCount] = useState(0);

	// Check if user is logged in with credentials provider
	const isCredentialsUser = status === "authenticated" && session?.user?.provider === "credentials";

	// Fetch unread count on mount and periodically
	useEffect(() => {
		if (!isCredentialsUser) {
			setUnreadCount(0);
			return;
		}

		const loadUnread = async () => {
			try {
				const count = await fetchUnreadCount();
				setUnreadCount(count);
			} catch {
				// Silently ignore errors
			}
		};

		// Initial load
		loadUnread();

		// Poll periodically
		const interval = setInterval(loadUnread, POLL_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [isCredentialsUser]);

	return (
		<Link
			href="/messages"
			className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
			title="站内信"
		>
			<Mail className="h-4 w-4" />
			{unreadCount > 0 && (
				<span
					className={cn(
						"absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-medium",
						unreadCount > 99 ? "h-4 min-w-4 px-1" : "h-4 w-4",
					)}
				>
					{unreadCount > 99 ? "99+" : unreadCount}
				</span>
			)}
		</Link>
	);
}
