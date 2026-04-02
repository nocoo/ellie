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
		<div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
			{/* Keyboard shortcuts hint */}
			<div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/90 backdrop-blur border border-border/50 shadow-lg text-2xs text-muted-foreground">
				{prevHref && (
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">[</kbd>
						<span>上页</span>
					</span>
				)}
				{nextHref && (
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">]</kbd>
						<span>下页</span>
					</span>
				)}
				{backHref && (
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">Esc</kbd>
						<span>返回</span>
					</span>
				)}
			</div>

			{/* Action buttons */}
			<div className="flex flex-col gap-2">
				{/* Scroll to top */}
				<Button
					onClick={scrollToTop}
					size="lg"
					className={cn(
						"rounded-full h-12 w-12 p-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl hover:shadow-2xl transition-all duration-200 hover:scale-105",
						!showScrollTop && "opacity-0 pointer-events-none translate-y-4",
					)}
					aria-label="回到顶部"
				>
					<Rocket className="h-5 w-5" />
				</Button>

				{/* Reply button */}
				{showReply && onReply && (
					<Button
						onClick={onReply}
						size="lg"
						className="rounded-full h-14 w-14 p-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl hover:shadow-2xl transition-all duration-200 hover:scale-105"
						aria-label="快速回复"
					>
						<MessageSquarePlus className="h-6 w-6" />
					</Button>
				)}
			</div>
		</div>
	);
}
