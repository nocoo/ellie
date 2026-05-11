"use client";

// Compact segmented control used as a panel switcher across the admin app.
//
// Replaces shadcn `Tabs` for the use-case "switch between a small number of
// inline panels above a content card". Tabs renders an h-10 control that,
// combined with the surrounding section header, makes pages feel taller than
// they need to be (the original report from Zheng Li on the KV monitor page).
// SegmentedSwitch is ~32px tall and lives directly above the content with no
// outer card wrapper, matching the standard admin control height (Button
// `size="sm"` is also h-8).
//
// Pattern borrowed from ../pew period-selector. The control itself is a
// `bg-secondary` track with `rounded-md` pill-shaped buttons; the active
// option lifts to `bg-background` + `shadow-sm`. On narrow viewports we
// allow horizontal scroll so a long Chinese label list does not force the
// page to grow vertically.
//
// Accessibility: this is a panel switcher (not a state toggle), so each
// button uses ARIA tablist semantics — `role="tablist"`/`role="tab"` +
// `aria-selected`. Pair with `<div role="tabpanel">` wrappers when wiring
// it into a page.

import { cn } from "@ellie/ui/utils";

export interface SegmentedOption<TValue extends string> {
	value: TValue;
	label: React.ReactNode;
	/** Optional accessible label, used when `label` is purely decorative. */
	ariaLabel?: string;
}

export interface SegmentedSwitchProps<TValue extends string> {
	value: TValue;
	onValueChange: (value: TValue) => void;
	options: SegmentedOption<TValue>[];
	/** Accessible label for the tablist (e.g. "切换 KV 监控视图"). */
	ariaLabel: string;
	className?: string;
}

export function SegmentedSwitch<TValue extends string>({
	value,
	onValueChange,
	options,
	ariaLabel,
	className,
}: SegmentedSwitchProps<TValue>): React.JSX.Element {
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			className={cn(
				"inline-flex h-8 items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary p-1",
				"max-w-full",
				className,
			)}
		>
			{options.map((opt) => {
				const selected = opt.value === value;
				return (
					<button
						key={opt.value}
						type="button"
						role="tab"
						aria-selected={selected}
						aria-label={opt.ariaLabel}
						onClick={() => {
							if (!selected) onValueChange(opt.value);
						}}
						className={cn(
							"inline-flex h-6 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
							selected
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}
