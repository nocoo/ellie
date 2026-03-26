// hooks/use-theme.ts — Three-state theme toggle (light → dark → system)
// Ref: 04b §暗黑模式 — localStorage("theme") + prefers-color-scheme listener

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

// ─── External store for SSR-safe theme state ──────────────────

const listeners: Set<() => void> = new Set();

function emitChange() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
	if (typeof window === "undefined") return "system";
	return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "system";
}

function getServerSnapshot(): Theme {
	return "system";
}

// ─── Resolved theme (what's actually applied) ─────────────────

function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
	return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(resolved: "light" | "dark") {
	const root = document.documentElement;
	root.classList.toggle("dark", resolved === "dark");
}

// ─── Hook ──────────────────────────────────────────────────────

export function useTheme() {
	const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const resolved = resolveTheme(theme);

	const setTheme = useCallback((next: Theme) => {
		if (next === "system") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, next);
		}
		applyTheme(resolveTheme(next));
		emitChange();
	}, []);

	const cycleTheme = useCallback(() => {
		const current = getSnapshot();
		const order: Theme[] = ["light", "dark", "system"];
		const idx = order.indexOf(current);
		setTheme(order[(idx + 1) % order.length]);
	}, [setTheme]);

	// Sync class on mount + system preference changes
	useEffect(() => {
		applyTheme(resolveTheme(getSnapshot()));

		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => {
			if (getSnapshot() === "system") {
				applyTheme(getSystemTheme());
				emitChange();
			}
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	return { theme, resolved, setTheme, cycleTheme } as const;
}

// ─── FOUC prevention script (inline in <head>) ────────────────

/**
 * Inline script to prevent FOUC. Must be inserted in <head> before any CSS.
 * Reads localStorage and sets .dark class immediately.
 */
export const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    var d = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
    if (d) document.documentElement.classList.add('dark');
  } catch(e) {}
})();
`.trim();
