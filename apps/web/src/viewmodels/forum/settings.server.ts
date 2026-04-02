/**
 * Public settings server-only reader.
 * Used by forum Server Components to read typed settings via Key A.
 */

import "server-only";
import { forumApi } from "@/lib/forum-api";

export type SettingsMap = Record<string, string | number | boolean | object>;

export async function fetchPublicSettings(): Promise<SettingsMap> {
	const res = await forumApi.get<SettingsMap>("/api/v1/settings");
	return res.data;
}

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
