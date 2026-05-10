"use client";

// Unified floating toolbar — compact horizontal bar at bottom-right.
// Consolidates scroll-to-top, prev/next page, back, jump-to-page,
// and context action (new thread / quick reply) into a single widget.
// All actions have keyboard shortcuts; tooltips show labels + shortcut keys.

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	ArrowUp,
	ChevronLeft,
	ChevronRight,
	Hash,
	MessageSquarePlus,
	SquarePen,
	Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloatingToolbarProps {
	/** Previous page URL */
	prevHref?: string | null;
	/** Next page URL */
	nextHref?: string | null;
	/** Back/escape URL (e.g. parent forum or home) */
	backHref?: string;
	/** Context action type: "reply" for thread detail, "new-thread" for forum list */
	actionType?: "reply" | "new-thread" | "none";
	/** Callback when context action is triggered */
	onAction?: () => void;
	/** Jump-to-page config (page-based pagination only) */
	jumpPage?: {
		basePath: string;
		pages: number;
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a keyboard event target is an input-like element */
function isInputTarget(e: KeyboardEvent): boolean {
	const t = e.target;
	return (
		t instanceof HTMLInputElement ||
		t instanceof HTMLTextAreaElement ||
		(t instanceof HTMLElement && t.isContentEditable)
	);
}

/** Check if a keyboard event has any modifier keys */
function hasModifier(e: KeyboardEvent): boolean {
	return e.metaKey || e.ctrlKey || e.altKey;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolbarButton({
	onClick,
	disabled,
	label,
	shortcut,
	children,
	className,
}: {
	onClick: () => void;
	disabled?: boolean;
	label: string;
	shortcut?: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={label}
						onClick={disabled ? undefined : onClick}
						disabled={disabled}
						className={cn(
							"inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors",
							disabled
								? "text-muted-foreground/40 cursor-not-allowed"
								: "text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer",
							className,
						)}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent side="top">
				{label}
				{shortcut && (
					<kbd className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-background/20 px-1 font-mono text-[10px]">
						{shortcut}
					</kbd>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

function ToolbarSeparator() {
	return <span className="h-5 w-px bg-border/60" />;
}

/** Inline jump-to-page popover */
function JumpPagePopover({
	basePath,
	pages,
	open,
	onOpenChange,
}: {
	basePath: string;
	pages: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const router = useRouter();
	const [value, setValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus input when popover opens; reset value when closed
	useEffect(() => {
		if (open) {
			const timer = setTimeout(() => inputRef.current?.focus(), 50);
			return () => clearTimeout(timer);
		}
		setValue("");
	}, [open]);

	const handleGo = useCallback(() => {
		const page = Number.parseInt(value, 10);
		if (Number.isNaN(page) || page < 1 || page > pages) return;
		onOpenChange(false);
		router.push(page === 1 ? basePath : `${basePath}?page=${page}`);
	}, [value, pages, basePath, router, onOpenChange]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<button
									type="button"
									aria-label="跳页"
									className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
								/>
							}
						/>
					}
				>
					<Hash className="h-4 w-4" />
				</TooltipTrigger>
				<TooltipContent side="top">
					跳页
					<kbd className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-background/20 px-1 font-mono text-[10px]">
						g
					</kbd>
				</TooltipContent>
			</Tooltip>
			<PopoverContent side="top" sideOffset={8} align="end" className="w-auto p-2">
				<div className="flex items-center gap-1.5">
					<span className="text-xs text-muted-foreground whitespace-nowrap">第</span>
					<input
						ref={inputRef}
						type="number"
						min={1}
						max={pages}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleGo();
							if (e.key === "Escape") onOpenChange(false);
						}}
						className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-xs text-center tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
						placeholder={`1-${pages}`}
					/>
					<span className="text-xs text-muted-foreground">页</span>
					<button
						type="button"
						onClick={handleGo}
						className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
					>
						Go
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FloatingToolbar({
	prevHref,
	nextHref,
	backHref,
	actionType = "none",
	onAction,
	jumpPage,
}: FloatingToolbarProps) {
	const router = useRouter();
	const [showScrollTop, setShowScrollTop] = useState(false);
	const [jumpPageOpen, setJumpPageOpen] = useState(false);
	const canJumpPage = !!jumpPage && jumpPage.pages > 1;

	// Track scroll position
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

	// Keyboard shortcuts — dispatch table to keep complexity low
	useEffect(() => {
		const nav = (href: string | null | undefined) => href && router.push(href);

		const keyActions: Record<string, () => void> = {
			"[": () => nav(prevHref),
			ArrowLeft: () => nav(prevHref),
			"]": () => nav(nextHref),
			ArrowRight: () => nav(nextHref),
			Escape: () => nav(backHref),
			Backspace: () => nav(backHref),
			t: scrollToTop,
		};
		if (actionType === "reply" && onAction) keyActions.r = onAction;
		if (actionType === "new-thread" && onAction) keyActions.n = onAction;
		if (canJumpPage) keyActions.g = () => setJumpPageOpen((prev) => !prev);

		const handleKeyDown = (e: KeyboardEvent) => {
			if (isInputTarget(e) || hasModifier(e)) return;
			const action = keyActions[e.key];
			if (action) {
				e.preventDefault();
				action();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [router, prevHref, nextHref, backHref, actionType, onAction, scrollToTop, canJumpPage]);

	const showAction = actionType !== "none" && onAction;

	return (
		<div className="fixed bottom-4 right-4 z-40">
			<TooltipProvider delay={300}>
				<div className="flex items-center gap-0.5 rounded-lg bg-card/90 backdrop-blur-sm border border-border/60 shadow-md px-1 h-9">
					{/* Scroll to top */}
					<ToolbarButton
						onClick={scrollToTop}
						disabled={!showScrollTop}
						label="回到顶部"
						shortcut="t"
					>
						<ArrowUp className="h-4 w-4" />
					</ToolbarButton>

					<ToolbarSeparator />

					{/* Prev page */}
					<ToolbarButton
						onClick={() => prevHref && router.push(prevHref)}
						disabled={!prevHref}
						label="上一页"
						shortcut="["
					>
						<ChevronLeft className="h-4 w-4" />
					</ToolbarButton>

					{/* Next page */}
					<ToolbarButton
						onClick={() => nextHref && router.push(nextHref)}
						disabled={!nextHref}
						label="下一页"
						shortcut="]"
					>
						<ChevronRight className="h-4 w-4" />
					</ToolbarButton>

					{/* Jump to page (page-based pagination only) */}
					{canJumpPage && jumpPage && (
						<JumpPagePopover
							basePath={jumpPage.basePath}
							pages={jumpPage.pages}
							open={jumpPageOpen}
							onOpenChange={setJumpPageOpen}
						/>
					)}

					<ToolbarSeparator />

					{/* Back */}
					{backHref && (
						<ToolbarButton onClick={() => router.push(backHref)} label="返回" shortcut="Esc">
							<Undo2 className="h-4 w-4" />
						</ToolbarButton>
					)}

					{/* Context action */}
					{showAction && (
						<>
							{backHref && <ToolbarSeparator />}
							<ToolbarButton
								onClick={onAction}
								label={actionType === "reply" ? "快速回帖" : "发表新帖"}
								shortcut={actionType === "reply" ? "r" : "n"}
								className={
									actionType === "reply"
										? "text-primary hover:text-primary hover:bg-primary/10"
										: "text-primary hover:text-primary hover:bg-primary/10"
								}
							>
								{actionType === "reply" ? (
									<MessageSquarePlus className="h-4 w-4" />
								) : (
									<SquarePen className="h-4 w-4" />
								)}
							</ToolbarButton>
						</>
					)}
				</div>
			</TooltipProvider>
		</div>
	);
}
