"use client";

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";

/**
 * Debounce window for the underlying Recharts ResponsiveContainer.
 * 180ms matches the firefly reference; long enough to avoid thrashing
 * on rapid resizes, short enough that a manual window drag still
 * feels live.
 */
const CHART_RESIZE_DEBOUNCE_MS = 180;

type DashboardResponsiveContainerProps = ComponentProps<typeof RechartsResponsiveContainer>;

/**
 * Wrapper around Recharts ResponsiveContainer that defers rendering
 * until the wrapper has a positive measured size.
 *
 * Why: Recharts logs noisy warnings when width/height resolve to ≤0
 * during initial layout (before the browser has painted) or while a
 * parent is collapsed. We observe the wrapper div via ResizeObserver
 * and only mount the actual ResponsiveContainer once both dimensions
 * are positive. Pattern lifted verbatim from firefly's
 * `responsive-container.tsx` so the chart UX stays consistent.
 */
export function DashboardResponsiveContainer({
	debounce = CHART_RESIZE_DEBOUNCE_MS,
	minWidth = 0,
	minHeight = 0,
	...props
}: DashboardResponsiveContainerProps) {
	const elRef = useRef<HTMLDivElement | null>(null);
	const [ready, setReady] = useState(false);

	const refCallback = useCallback((node: HTMLDivElement | null) => {
		elRef.current = node;
		if (!node) return;
		const { width, height } = node.getBoundingClientRect();
		if (width > 0 && height > 0) setReady(true);
	}, []);

	useEffect(() => {
		if (ready) return;
		const el = elRef.current;
		if (!el) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				if (width > 0 && height > 0) {
					setReady(true);
					observer.disconnect();
					return;
				}
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [ready]);

	return (
		<div ref={refCallback} style={{ width: "100%", height: "100%" }}>
			{ready && (
				<RechartsResponsiveContainer
					debounce={debounce}
					minWidth={minWidth}
					minHeight={minHeight}
					{...props}
				/>
			)}
		</div>
	);
}
