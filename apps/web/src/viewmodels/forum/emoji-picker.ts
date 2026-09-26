import { SMILEY_PACKS } from "@ellie/shared/smiley";

export const RECENT_EMOJIS_KEY = "ellie_recent_emojis";
const MAX_RECENT = 16;

export type RecentEmoji =
	| { type: "unicode"; value: string }
	| { type: "forum"; value: string; pack: "default"; file: string };

export function addRecentEmoji(item: RecentEmoji, current: RecentEmoji[]): RecentEmoji[] {
	return [
		item,
		...current.filter((entry) => entry.type !== item.type || entry.value !== item.value),
	].slice(0, MAX_RECENT);
}

export function loadRecentEmojis(): RecentEmoji[] {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(RECENT_EMOJIS_KEY) ?? "[]");
		if (!Array.isArray(stored)) return [];
		const recent: RecentEmoji[] = [];
		for (const item of stored) {
			if (!item || typeof item.value !== "string" || !item.value.trim()) continue;
			if (recent.some((entry) => entry.type === item.type && entry.value === item.value)) continue;
			if (item.type === "unicode") {
				recent.push({ type: "unicode", value: item.value });
			} else if (item.type === "forum" && item.pack === "default") {
				const smiley = SMILEY_PACKS.default.find((entry) => entry.code === item.value);
				if (smiley)
					recent.push({ type: "forum", value: smiley.code, pack: "default", file: smiley.file });
			}
		}
		return recent.slice(0, MAX_RECENT);
	} catch {
		return [];
	}
}

export function saveRecentEmojis(items: RecentEmoji[]): void {
	try {
		localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
	} catch {
		// Selection must still work when browser storage is unavailable.
	}
}
