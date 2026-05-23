import type { BreadcrumbItem } from "@ellie/shared";
import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";

export type { BreadcrumbItem } from "@ellie/shared";

/**
 * `mobileCompact` controls intermediate-segment visibility on mobile (<640px).
 *
 *   - "none" (default): all segments visible on every breakpoint, original
 *     behavior — used by user pages, search, messages, anywhere the chain
 *     does not have known forum-ancestor depth.
 *
 *   - "hide-intermediate": keep first (home), keep last linked segment
 *     (the closest forum to the current page), keep current (trailing
 *     non-linked) page. Hide every other intermediate linked segment
 *     plus the chevron immediately preceding it on mobile only. This
 *     is the thread-detail simplification per reviewer freeze
 *     msg=5a91dfd3 — collapses 首页 → 分区A → 分区B → 版块 → 主题
 *     down to 首页 → 版块 → 主题 on phones while desktop is unchanged.
 */
type MobileCompactMode = "none" | "hide-intermediate";

interface BreadcrumbsProps {
	items: BreadcrumbItem[];
	mobileCompact?: MobileCompactMode;
}

export function Breadcrumbs({ items, mobileCompact = "none" }: BreadcrumbsProps) {
	// Precompute the set of indices to hide on mobile so the JSX stays a flat
	// `.map`. "hide-intermediate" hides every linked segment except the last
	// linked one; first item (index 0, the home segment) is always kept.
	const mobileHiddenIndices = new Set<number>();
	if (mobileCompact === "hide-intermediate") {
		// Find the index of the last linked (`href`-bearing) item — that's
		// the closest forum ancestor to the current page.
		let lastLinkedIndex = -1;
		for (let i = 0; i < items.length; i++) {
			if (items[i]?.href !== undefined) lastLinkedIndex = i;
		}
		// Hide every linked intermediate segment except index 0 (home) and
		// the last linked one. Non-linked segments (current page) stay
		// visible because they carry the user's current context.
		for (let i = 1; i < items.length; i++) {
			const item = items[i];
			if (!item) continue;
			if (item.href === undefined) continue;
			if (i === lastLinkedIndex) continue;
			mobileHiddenIndices.add(i);
		}
	}

	return (
		<nav className="flex items-center gap-1 text-sm text-muted-foreground">
			{items.map((item, index) => {
				// On mobile, hide the segment AND the chevron-prefix as a single
				// inline-flex unit so collapsing a middle item doesn't leave a
				// floating `>` separator.
				const mobileHidden = mobileHiddenIndices.has(index);
				return (
					<span
						key={item.label}
						className={`flex items-center gap-1${mobileHidden ? " hidden sm:inline-flex" : ""}`}
						data-testid={mobileHidden ? "breadcrumb-segment-mobile-hidden" : "breadcrumb-segment"}
					>
						{index > 0 && <ChevronRight className="h-3 w-3" />}
						{item.href ? (
							<Link
								href={item.href}
								className="flex items-center gap-1 hover:text-foreground transition-colors"
							>
								{item.icon === "home" && <Home className="h-3.5 w-3.5" />}
								{item.label}
							</Link>
						) : (
							<span className="text-foreground font-medium">{item.label}</span>
						)}
					</span>
				);
			})}
		</nav>
	);
}
