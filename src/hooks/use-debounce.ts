// hooks/use-debounce.ts — Debounce hook for search inputs
// Ref: 04b §共享布局组件

"use client";

import { useEffect, useState } from "react";

/**
 * Debounces a value by the specified delay (ms).
 * Returns the debounced value — updates only after `delay` ms of inactivity.
 */
export function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}
