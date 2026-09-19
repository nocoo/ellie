// MessageBadgeIcon — Mail icon with unread count badge for header
// Only fetches unread count for credentials users (who have Worker JWT)
// Polls at a relaxed interval suited for sparse-traffic forums, and pauses
// when the browser tab is hidden to avoid wasting requests.

"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { HeaderTooltip } from "@/components/header-links";
import { cn } from "@/lib/utils";
import { fetchUnreadCount } from "@/viewmodels/forum/messages";

// ---------------------------------------------------------------------------
// Refresh interval for polling unread count
// ---------------------------------------------------------------------------

// Passive checks are at most once per ten minutes, including tab refocus.
const POLL_INTERVAL_MS = 600_000;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MessageBadgeIcon() {
	const { data: session, status } = useSession();
	const [unreadCount, setUnreadCount] = useState(0);
	const isCredentialsUser = status === "authenticated" && session?.user?.provider === "credentials";
	const userId = session?.user?.id;

	useEffect(() => {
		setUnreadCount(0);
		if (!isCredentialsUser || !userId) return;
		let cancelled = false;
		let lastCheck = -Infinity;
		let timer: ReturnType<typeof setTimeout>;
		const check = () => {
			clearTimeout(timer);
			if (document.visibilityState !== "visible") return;
			const remaining = POLL_INTERVAL_MS - (Date.now() - lastCheck);
			if (remaining > 0) {
				timer = setTimeout(check, remaining);
				return;
			}
			lastCheck = Date.now();
			void fetchUnreadCount()
				.then((count) => {
					if (!cancelled) setUnreadCount(count);
				})
				.catch(() => {
					/* Retry at the next passive check. */
				});
			timer = setTimeout(check, POLL_INTERVAL_MS);
		};
		check();
		document.addEventListener("visibilitychange", check);
		return () => {
			cancelled = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", check);
		};
	}, [isCredentialsUser, userId]);

	return (
		<HeaderTooltip label="站内信">
			<Link
				href="/messages"
				className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
				aria-label="站内信"
			>
				<Mail className="pointer-events-none h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
				{unreadCount > 0 && (
					<span
						className={cn(
							"absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-medium leading-none",
							unreadCount > 99 ? "h-4 min-w-5 px-1" : "h-4 w-4",
						)}
						data-testid="message-badge-count"
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</Link>
		</HeaderTooltip>
	);
}
