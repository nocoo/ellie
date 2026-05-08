"use client";

// Floating action buttons with keyboard shortcuts
// - Scroll to top (rocket icon)
// - Reply button (when provided)
// - Keyboard shortcut hints

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface FloatingActionsProps {
	/** Show reply button */
	showReply?: boolean;
	/** Callback when reply button is clicked */
	onReply?: () => void;
	/** Previous page URL for keyboard navigation */
	prevHref?: string | null;
	/** Next page URL for keyboard navigation */
	nextHref?: string | null;
	/** Back URL (for Escape key) */
	backHref?: string;
}

export function FloatingActions({
	showReply = false,
	onReply,
	prevHref,
	nextHref,
	backHref,
}: FloatingActionsProps) {
	const router = useRouter();
	const [showScrollTop, setShowScrollTop] = useState(false);

	// Track scroll position to show/hide scroll-to-top button
	useEffect(() => {
		const handleScroll = () => {
			setShowScrollTop(window.scrollY > 300);
		};
		window.addEventListener("scroll", handleScroll, { passive: true });
		handleScroll();
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const scrollToTop = useCallback(() => {
		window.scrollTo({ top: 0, behavior: "smooth" });
	}, []);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ignore if user is typing in an input
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target as HTMLElement).isContentEditable
			) {
				return;
			}

			switch (e.key) {
				case "[":
				case "ArrowLeft":
					// Previous page
					if (prevHref) {
						e.preventDefault();
						router.push(prevHref);
					}
					break;
				case "]":
				case "ArrowRight":
					// Next page
					if (nextHref) {
						e.preventDefault();
						router.push(nextHref);
					}
					break;
				case "Escape":
				case "Backspace":
					// Go back
					if (backHref && e.key === "Escape") {
						e.preventDefault();
						router.push(backHref);
					} else if (e.key === "Backspace" && backHref) {
						e.preventDefault();
						router.push(backHref);
					}
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [router, prevHref, nextHref, backHref]);

	return (
		<div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
			{/* Action buttons */}
			<div className="flex flex-col gap-2">
				{/* Reply button */}
				{showReply && onReply && (
					<Button
						onClick={onReply}
						size="icon"
						className="rounded-full h-10 w-10 bg-card hover:bg-accent text-foreground border border-border shadow-lg hover:shadow-xl transition-all duration-200"
						aria-label="快速回复"
					>
						<MessageSquarePlus className="h-4 w-4" />
					</Button>
				)}

				{/* Scroll to top */}
				<Button
					onClick={scrollToTop}
					size="icon"
					className={cn(
						"rounded-full h-10 w-10 bg-card hover:bg-accent text-foreground border border-border shadow-lg hover:shadow-xl transition-all duration-200",
						!showScrollTop && "opacity-0 pointer-events-none translate-y-2",
					)}
					aria-label="回到顶部"
				>
					<Rocket className="h-4 w-4" />
				</Button>
			</div>

			{/* Keyboard shortcuts hint - below buttons, smaller text */}
			<div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/80 backdrop-blur border border-border/50 shadow-md text-2xs text-muted-foreground">
				{prevHref && (
					<span className="flex items-center gap-0.5">
						<kbd className="px-1 py-0.5 rounded bg-muted font-mono text-2xs">[</kbd>
						<span>上页</span>
					</span>
				)}
				{nextHref && (
					<span className="flex items-center gap-0.5">
						<kbd className="px-1 py-0.5 rounded bg-muted font-mono text-2xs">]</kbd>
						<span>下页</span>
					</span>
				)}
				{backHref && (
					<span className="flex items-center gap-0.5">
						<kbd className="px-1 py-0.5 rounded bg-muted font-mono text-2xs">Esc</kbd>
						<span>返回</span>
					</span>
				)}
			</div>
		</div>
	);
}
