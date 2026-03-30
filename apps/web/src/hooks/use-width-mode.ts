// hooks/use-width-mode.ts — Width mode toggle (centered ↔ full-width)
// Ref: 04f §2 — mirrors use-theme.ts pattern: localStorage + useSyncExternalStore
// Uses data-width-mode attribute on <html> + CSS selectors to avoid hydration mismatch.

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type WidthMode = "centered" | "full";

const STORAGE_KEY = "width-mode";

// ─── External store (same pattern as use-theme.ts) ───────────

const listeners: Set<() => void> = new Set();

function emitChange() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): WidthMode {
	if (typeof window === "undefined") return "centered";
	return (localStorage.getItem(STORAGE_KEY) as WidthMode) ?? "centered";
}

function getServerSnapshot(): WidthMode {
	return "centered";
}

// ─── Apply to DOM ────────────────────────────────────────────

function applyWidthMode(mode: WidthMode) {
	if (typeof document === "undefined") return;
	if (mode === "full") {
		document.documentElement.dataset.widthMode = "full";
	} else {
		delete document.documentElement.dataset.widthMode;
	}
}

// ─── Hook ────────────────────────────────────────────────────

export function useWidthMode() {
	const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	const setMode = useCallback((next: WidthMode) => {
		if (next === "centered") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, next);
		}
		applyWidthMode(next);
		emitChange();
	}, []);

	const toggleMode = useCallback(() => {
		setMode(getSnapshot() === "centered" ? "full" : "centered");
	}, [setMode]);

	// Sync DOM attribute on mount
	useEffect(() => {
		applyWidthMode(getSnapshot());
	}, []);

	return { mode, setMode, toggleMode } as const;
}

// ─── FOUC prevention script (inline in <head>) ──────────────

/**
 * Inline script to set data-width-mode on <html> before first paint.
 * CSS selectors `:root[data-width-mode="full"]` drive the layout —
 * React never touches the container className, so no hydration mismatch.
 */
export const widthModeInitScript = `
(function(){
  try {
    var m = localStorage.getItem('${STORAGE_KEY}');
    if (m === 'full') document.documentElement.dataset.widthMode = 'full';
  } catch(e) {}
})();
`.trim();
