import { describe, expect, it } from "bun:test";
import {
	enrichThreads,
	getThreadIconSrc,
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
		authorAvatar: "",
		subject: "Test thread",
		createdAt: 1711600000,
		lastPostAt: 1711610000,
		lastPoster: "testuser",
		lastPosterId: 1,
		lastPosterAvatar: "",
		replies: 0,
		views: 100,
		closed: 0,
		sticky: StickyLevel.None,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
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

	it("enriches multiple threads", () => {
		const threads = [makeThread({ id: 1 }), makeThread({ id: 2, digest: 1 })];
		const items = enrichThreads(threads);
		expect(items).toHaveLength(2);
		expect(items[1]?.thread.id).toBe(2);
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

	it("returns undefined for highlight with only bold/italic flags but no actual visual properties applied", () => {
		// If decodeHighlight returns a non-null object but with all empty/null visual props,
		// highlightStyle returns undefined because Object.keys(style).length === 0
		// This covers the edge case: non-null hl but no color, bold, italic, or underline
		const hl = { color: null, bold: false, italic: false, underline: false };
		expect(highlightStyle(hl as ReturnType<typeof decodeHighlight>)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// getThreadIconSrc
// ---------------------------------------------------------------------------

describe("getThreadIconSrc", () => {
	it("returns lock icon for closed thread", () => {
		const result = getThreadIconSrc({
			closed: 1,
			special: 0,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("folder_lock.gif");
	});

	it("returns poll icon for special=1 thread", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 1,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pollsmall.gif");
	});

	it("returns pin icon for forum-level sticky", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.Forum,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pin_1.gif");
	});

	it("returns pin icon for global sticky", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.Global,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pin_2.gif");
	});

	it("returns pin icon for category sticky (level 3)", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.Category,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pin_3.gif");
	});

	it("caps sticky level at 3 for pin icon filename", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: 5 as StickyLevel, // Higher than max
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		// Math.min(sticky, 3) = 3
		expect(result).toContain("pin_3.gif");
	});

	it("returns digest icon for digest level 1", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 1,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("digest_1.gif");
	});

	it("returns digest icon for digest level 3", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 3,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("digest_3.gif");
	});

	it("caps digest level at 3 for digest icon filename", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 5,
			lastPostAt: Date.now() / 1000,
		});
		// Math.min(digest, 3) = 3
		expect(result).toContain("digest_3.gif");
	});

	it("returns folder_new for thread with recent reply (within 24 hours)", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: now - 100,
		});
		expect(result).toContain("folder_new.gif");
	});

	it("returns folder_common for old thread (no recent reply)", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: now - 100000,
		});
		expect(result).toContain("folder_common.gif");
	});

	it("prioritizes closed over all other states", () => {
		const result = getThreadIconSrc({
			closed: 1,
			special: 1,
			sticky: StickyLevel.Global,
			digest: 3,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("folder_lock.gif");
	});

	it("prioritizes special over sticky/digest/recent", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 1,
			sticky: StickyLevel.Global,
			digest: 3,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pollsmall.gif");
	});

	it("prioritizes sticky over digest/recent", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.Forum,
			digest: 2,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("pin_1.gif");
	});

	it("prioritizes digest over recent/old", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 2,
			lastPostAt: now - 100000,
		});
		expect(result).toContain("digest_2.gif");
	});

	it("returns CDN URLs", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: 0,
		});
		expect(result).toContain("https://t.no.mt/static/image/common/");
	});
});
