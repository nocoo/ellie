// MessageBadgeIcon — Mail icon with unread count badge for header
// Only fetches unread count for credentials users (who have Worker JWT)
// Polls at a relaxed interval suited for sparse-traffic forums, and pauses
// when the browser tab is hidden to avoid wasting requests.

"use client";

import { cn } from "@/lib/utils";
import { fetchUnreadCount } from "@/viewmodels/forum/messages";
import { Mail } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Refresh interval for polling unread count
// ---------------------------------------------------------------------------

// 5 minutes — sufficient for sparse-traffic forums; the tab-visibility
// listener triggers an immediate refresh when the user switches back.
const POLL_INTERVAL_MS = 300_000;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MessageBadgeIcon() {
	const { data: session, status } = useSession();
	const [unreadCount, setUnreadCount] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Check if user is logged in with credentials provider
	const isCredentialsUser = status === "authenticated" && session?.user?.provider === "credentials";

	const loadUnread = useCallback(async () => {
		try {
			const count = await fetchUnreadCount();
			setUnreadCount(count);
		} catch {
			// Silently ignore errors
		}
	}, []);

	// Poll with visibility awareness: pause when hidden, resume + immediate
	// refresh when visible again.
	useEffect(() => {
		if (!isCredentialsUser) {
			setUnreadCount(0);
			return;
		}

		const startPolling = () => {
			if (intervalRef.current) return; // already running
			intervalRef.current = setInterval(loadUnread, POLL_INTERVAL_MS);
		};

		const stopPolling = () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};

		const handleVisibility = () => {
			if (document.visibilityState === "visible") {
				loadUnread(); // immediate refresh when user switches back
				startPolling();
			} else {
				stopPolling();
			}
		};

		// Initial load + start polling (only if tab is visible)
		loadUnread();
		if (document.visibilityState === "visible") {
			startPolling();
		}

		document.addEventListener("visibilitychange", handleVisibility);

		return () => {
			stopPolling();
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [isCredentialsUser, loadUnread]);

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
						"absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-2xs font-medium",
						unreadCount > 99 ? "h-4 min-w-4 px-1" : "h-4 w-4",
					)}
				>
					{unreadCount > 99 ? "99+" : unreadCount}
				</span>
			)}
		</Link>
	);
}
