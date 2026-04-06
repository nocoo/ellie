"use client";

import { createContext, useContext, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BreadcrumbOverrideCtx {
	/** Label override for the last breadcrumb segment */
	override: string | null;
	setOverride: (label: string | null) => void;
}

const BreadcrumbOverrideContext = createContext<BreadcrumbOverrideCtx>({
	override: null,
	setOverride: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BreadcrumbOverrideProvider({ children }: { children: React.ReactNode }) {
	const [override, setOverride] = useState<string | null>(null);
	return (
		<BreadcrumbOverrideContext.Provider value={{ override, setOverride }}>
			{children}
		</BreadcrumbOverrideContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Read the current breadcrumb override (used by AppShell). */
export function useBreadcrumbOverrideValue(): string | null {
	return useContext(BreadcrumbOverrideContext).override;
}

/**
 * Set a dynamic label for the last breadcrumb segment.
 * Pass `null` to clear. Automatically clears on unmount.
 */
export function useBreadcrumbOverride(label: string | null): void {
	const { setOverride } = useContext(BreadcrumbOverrideContext);

	useEffect(() => {
		setOverride(label);
		return () => setOverride(null);
	}, [label, setOverride]);
}
