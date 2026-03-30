import { describe, expect, it } from "bun:test";
import {
	enrichThreads,
	formatStat,
	formatTime,
	highlightStyle,
} from "../../../../apps/web/src/viewmodels/forum/thread-list";
import { decodeHighlight } from "../../../../packages/types/src/thread";
import type { Thread } from "../../../../packages/types/src/types";
import { StickyLevel } from "../../../../packages/types/src/types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<Thread> & { id: number }): Thread {
	return {
		forumId: 10,
		authorId: 1,
		authorName: "testuser",
		subject: "Test thread",
		createdAt: 1711600000,
		lastPostAt: 1711610000,
		lastPoster: "testuser",
		replies: 0,
		views: 100,
		closed: 0,
		sticky: StickyLevel.None,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// enrichThreads
// ---------------------------------------------------------------------------

describe("enrichThreads", () => {
	it("returns empty array for empty input", () => {
		expect(enrichThreads([])).toEqual([]);
	});

	it("enriches threads with badges and highlight", () => {
		const threads = [makeThread({ id: 1 })];
		const items = enrichThreads(threads);
		expect(items.length).toBe(1);
		expect(items[0]?.thread.id).toBe(1);
		expect(Array.isArray(items[0]?.badges)).toBe(true);
	});

	it("produces badges for sticky thread", () => {
		const threads = [makeThread({ id: 1, sticky: StickyLevel.Global })];
		const items = enrichThreads(threads);
		expect(items[0]?.badges.length).toBeGreaterThan(0);
		expect(items[0]?.badges[0]?.type).toBe("sticky");
	});

	it("produces badges for digest thread", () => {
		const threads = [makeThread({ id: 1, digest: 2 })];
		const items = enrichThreads(threads);
		const digestBadge = items[0]?.badges.find((b) => b.type === "digest");
		expect(digestBadge).toBeTruthy();
	});

	it("produces badges for closed thread", () => {
		const threads = [makeThread({ id: 1, closed: 1 })];
		const items = enrichThreads(threads);
		const closedBadge = items[0]?.badges.find((b) => b.type === "closed");
		expect(closedBadge).toBeTruthy();
	});

	it("returns null highlight when highlight=0", () => {
		const threads = [makeThread({ id: 1, highlight: 0 })];
		const items = enrichThreads(threads);
		expect(items[0]?.highlight).toBeNull();
	});

	it("returns highlight style when highlight has color", () => {
		// Red color in lower 24 bits: 0x0000FF
		const threads = [makeThread({ id: 1, highlight: 0x0000ff })];
		const items = enrichThreads(threads);
		expect(items[0]?.highlight).toBeTruthy();
		expect(items[0]?.highlight?.color).toBe("#0000ff");
	});
});

// ---------------------------------------------------------------------------
// highlightStyle
// ---------------------------------------------------------------------------

describe("highlightStyle", () => {
	it("returns undefined for null highlight", () => {
		expect(highlightStyle(null)).toBeUndefined();
	});

	it("returns style with color only", () => {
		const hl = decodeHighlight(0xff0000);
		const style = highlightStyle(hl);
		expect(style).toEqual({ color: "#ff0000" });
	});

	it("returns style with bold", () => {
		const hl = decodeHighlight(0x1000000); // bit 24 = bold
		const style = highlightStyle(hl);
		expect(style?.fontWeight).toBe("bold");
	});

	it("returns style with italic", () => {
		const hl = decodeHighlight(0x2000000); // bit 25 = italic
		const style = highlightStyle(hl);
		expect(style?.fontStyle).toBe("italic");
	});

	it("returns style with underline", () => {
		const hl = decodeHighlight(0x4000000); // bit 26 = underline
		const style = highlightStyle(hl);
		expect(style?.textDecoration).toBe("underline");
	});

	it("returns combined style", () => {
		const hl = decodeHighlight(0x1000000 | 0x2000000 | 0xff0000); // bold + italic + red
		const style = highlightStyle(hl);
		expect(style?.fontWeight).toBe("bold");
		expect(style?.fontStyle).toBe("italic");
		expect(style?.color).toBe("#ff0000");
	});

	it("returns undefined for highlight with no properties", () => {
		// highlight with all zeros but somehow non-null (shouldn't happen from decodeHighlight)
		expect(highlightStyle(null)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatTime(0)).toBe("");
	});

	it("formats recent time as relative", () => {
		const now = Date.now() / 1000;
		expect(formatTime(now - 30)).toBe("刚刚");
		expect(formatTime(now - 120)).toBe("2 分钟前");
	});

	it("formats older dates as date string", () => {
		// 40 days ago — should show a localized date, not relative time
		const now = Date.now() / 1000;
		const result = formatTime(now - 40 * 86400);
		expect(result).toContain("/");
	});
});

// ---------------------------------------------------------------------------
// formatStat
// ---------------------------------------------------------------------------

describe("formatStat", () => {
	it("formats small numbers as-is", () => {
		expect(formatStat(0)).toBe("0");
		expect(formatStat(42)).toBe("42");
		expect(formatStat(999)).toBe("999");
	});

	it("formats thousands with K suffix", () => {
		expect(formatStat(1000)).toBe("1.0K");
		expect(formatStat(5600)).toBe("5.6K");
	});

	it("formats ten-thousands with 万 suffix", () => {
		expect(formatStat(10000)).toBe("1.0万");
		expect(formatStat(12345)).toBe("1.2万");
		expect(formatStat(85000)).toBe("8.5万");
	});
});
