// hooks/use-is-mobile.ts — Responsive breakpoint hook
// Ref: 04b §响应式 — Mobile <768px

"use client";

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Returns true when viewport width is below mobile breakpoint (768px).
 * Uses matchMedia for efficient listening (no resize handler).
 */
export function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		setIsMobile(mq.matches);

		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	return isMobile;
}

export { MOBILE_BREAKPOINT };
