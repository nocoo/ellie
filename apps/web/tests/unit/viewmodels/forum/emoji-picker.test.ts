// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addRecentEmoji,
	loadRecentEmojis,
	RECENT_EMOJIS_KEY,
	type RecentEmoji,
	saveRecentEmojis,
} from "@/viewmodels/forum/emoji-picker";

const forum: RecentEmoji = { type: "forum", value: ":smile:", pack: "default", file: "smile.gif" };
const unicode: RecentEmoji = { type: "unicode", value: "😀" };

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("unified recent emojis", () => {
	it("persists a mixed list and moves reused entries to the front", () => {
		saveRecentEmojis(addRecentEmoji(forum, addRecentEmoji(unicode, [forum])));
		expect(loadRecentEmojis()).toEqual([forum, unicode]);
	});

	it("caps both updates and persisted lists at sixteen", () => {
		const entries: RecentEmoji[] = Array.from({ length: 20 }, (_, index) => ({
			type: "unicode",
			value: String.fromCodePoint(0x1f600 + index),
		}));
		expect(addRecentEmoji(forum, entries)).toHaveLength(16);
		saveRecentEmojis(entries);
		expect(loadRecentEmojis()).toEqual(entries.slice(0, 16));
		localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(entries));
		expect(loadRecentEmojis()).toHaveLength(16);
	});

	it("removes disabled packs, malformed entries and duplicates and derives trusted filenames", () => {
		localStorage.setItem(
			RECENT_EMOJIS_KEY,
			JSON.stringify([
				null,
				{},
				{ type: "unicode", value: 3 },
				{ type: "unicode", value: " " },
				{ type: "other", value: "x" },
				{ type: "forum", value: "{:2_133:}", pack: "coolmonkey", file: "01.gif" },
				{ type: "forum", value: ":unknown:", pack: "default" },
				{ ...forum, file: "../../bad.gif" },
				forum,
				unicode,
				unicode,
			]),
		);
		expect(loadRecentEmojis()).toEqual([forum, unicode]);
	});

	it.each([null, "{}", "null", "invalid"])("tolerates absent or invalid storage: %s", (stored) => {
		if (stored !== null) localStorage.setItem(RECENT_EMOJIS_KEY, stored);
		expect(loadRecentEmojis()).toEqual([]);
	});

	it("still permits selection when storage is blocked", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(loadRecentEmojis()).toEqual([]);
		expect(() => saveRecentEmojis([forum])).not.toThrow();
	});
});
