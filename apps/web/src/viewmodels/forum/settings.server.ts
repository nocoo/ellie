/**
 * Public settings server-only reader.
 * Used by forum Server Components to read typed settings via Key A.
 *
 * The actual fetch is defined in `lib/public-settings.ts` (a pure loader
 * with no cache). RSC render-pass deduplication is handled by
 * `lib/forum-cache.ts` which wraps it with React `cache()`.
 */

import "server-only";
import { getCachedPublicSettings } from "@/lib/forum-cache";
import type { SettingsMap } from "@/lib/public-settings";

export type { SettingsMap };

export const fetchPublicSettings = getCachedPublicSettings;

/* ── Typed accessor helpers ── */

export function getStr(settings: SettingsMap, key: string, fallback: string): string {
	const v = settings[key];
	if (typeof v === "string") return v;
	if (v !== undefined && v !== null) return String(v);
	return fallback;
}

export function getNum(settings: SettingsMap, key: string, fallback: number): number {
	const v = settings[key];
	if (typeof v === "number") return v;
	if (typeof v === "string") {
		const n = Number(v);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

export function getBool(settings: SettingsMap, key: string, fallback: boolean): boolean {
	const v = settings[key];
	if (typeof v === "boolean") return v;
	if (v === "true") return true;
	if (v === "false") return false;
	return fallback;
}

export function getArr<T>(settings: SettingsMap, key: string, fallback: T[]): T[] {
	const v = settings[key];
	if (Array.isArray(v)) return v as T[];
	return fallback;
}
