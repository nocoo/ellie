import {
	cursorToPage,
	enrichThreads,
	filterIconRedundantBadges,
	getDigestIconSrc,
	getInlinePageItems,
	getNewbieStampSrc,
	getThreadIconSrc,
	getThreadPageCount,
	getThreadPageUrl,
	highlightStyle,
	pageToPostCursor,
	resolveCurrentPage,
	resolveThreadPostCursor,
	validateReturnTo,
} from "@/viewmodels/forum/thread-list";
import { decodeHighlight, getThreadBadges } from "@ellie/types";
import type { Thread } from "@ellie/types";
import { StickyLevel } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<Thread> & { id: number }): Thread {
	return {
		forumId: 10,
		authorId: 1,
		authorName: "testuser",
		authorAvatar: "",
		authorAvatarPath: "",
		subject: "Test thread",
		createdAt: 1711600000,
		lastPostAt: 1711610000,
		lastPoster: "testuser",
		lastPosterId: 1,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		replies: 0,
		views: 100,
		closed: 0,
		sticky: StickyLevel.None,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
		isAuthorFirstThread: false,
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
		expect(items[0]?.digestSrc).toBeNull();
	});

	it("produces badges for sticky thread (filtered: no sticky badge)", () => {
		const threads = [makeThread({ id: 1, sticky: StickyLevel.Global })];
		const items = enrichThreads(threads);
		// sticky badge filtered out — icon represents it
		expect(items[0]?.badges.some((b) => b.type === "sticky")).toBe(false);
	});

	it("produces badges for digest thread (filtered: no digest badge)", () => {
		const threads = [makeThread({ id: 1, digest: 2 })];
		const items = enrichThreads(threads);
		// digest badge filtered out — shown as icon to the right of title
		expect(items[0]?.badges.some((b) => b.type === "digest")).toBe(false);
		expect(items[0]?.digestSrc).toContain("digest_2.gif");
	});

	it("produces badges for closed thread (filtered: no closed badge)", () => {
		const threads = [makeThread({ id: 1, closed: 1 })];
		const items = enrichThreads(threads);
		// closed badge filtered out — icon represents it
		expect(items[0]?.badges.some((b) => b.type === "closed")).toBe(false);
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

	it("returns null newbieStampSrc for non-first thread", () => {
		const threads = [makeThread({ id: 1, isAuthorFirstThread: false })];
		const items = enrichThreads(threads);
		expect(items[0]?.newbieStampSrc).toBeNull();
	});

	it("returns stamp URL for author first thread", () => {
		const threads = [makeThread({ id: 1, isAuthorFirstThread: true })];
		const items = enrichThreads(threads);
		expect(items[0]?.newbieStampSrc).toContain("011.small.gif");
	});

	// isGlobalAnnouncement — drives the red Megaphone icon in the row.
	// Only sticky=2 (Global) flips this on; sticky=1 (Forum) and sticky=3
	// (Category) must keep the classic pin gif via iconSrc and leave this
	// flag false so the icon column never replaces a category-pin row's
	// pin_3.gif with the announcement megaphone.
	it("marks isGlobalAnnouncement=true only for sticky=Global (2)", () => {
		const items = enrichThreads([makeThread({ id: 1, sticky: StickyLevel.Global })]);
		expect(items[0]?.isGlobalAnnouncement).toBe(true);
	});

	it("marks isGlobalAnnouncement=false for sticky=None (0)", () => {
		const items = enrichThreads([makeThread({ id: 1, sticky: StickyLevel.None })]);
		expect(items[0]?.isGlobalAnnouncement).toBe(false);
	});

	it("marks isGlobalAnnouncement=false for sticky=Forum (1)", () => {
		const items = enrichThreads([makeThread({ id: 1, sticky: StickyLevel.Forum })]);
		expect(items[0]?.isGlobalAnnouncement).toBe(false);
	});

	it("marks isGlobalAnnouncement=false for sticky=Category (3)", () => {
		const items = enrichThreads([makeThread({ id: 1, sticky: StickyLevel.Category })]);
		expect(items[0]?.isGlobalAnnouncement).toBe(false);
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

	it("returns trade icon for special=2 thread", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 2,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("tradesmall.gif");
	});

	it("returns reward icon for special=3 thread", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 3,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("rewardsmall.gif");
	});

	it("returns activity icon for special=4 thread", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 4,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("activitysmall.gif");
	});

	it("returns debate icon for special=5 thread", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 5,
			sticky: StickyLevel.None,
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		expect(result).toContain("debatesmall.gif");
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

	it("caps sticky level at 4 for pin icon filename", () => {
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: 5 as StickyLevel, // Higher than max
			digest: 0,
			lastPostAt: Date.now() / 1000,
		});
		// Math.min(sticky, 4) = 4
		expect(result).toContain("pin_4.gif");
	});

	it("returns folder_new for digest thread with recent reply (digest shown separately)", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 3,
			lastPostAt: now - 100,
		});
		// digest icon is shown to the right of the title, not in the icon column
		expect(result).toContain("folder_new.gif");
	});

	it("returns folder_common for digest thread with old reply", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 2,
			lastPostAt: now - 100000,
		});
		expect(result).toContain("folder_common.gif");
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

	it("digest does not affect icon column (falls through to folder)", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = getThreadIconSrc({
			closed: 0,
			special: 0,
			sticky: StickyLevel.None,
			digest: 2,
			lastPostAt: now - 100000,
		});
		expect(result).toContain("folder_common.gif");
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

// ---------------------------------------------------------------------------
// getDigestIconSrc
// ---------------------------------------------------------------------------

describe("getDigestIconSrc", () => {
	it("returns null for non-digest thread (digest=0)", () => {
		expect(getDigestIconSrc(0)).toBeNull();
	});

	it("returns null for negative digest", () => {
		expect(getDigestIconSrc(-1)).toBeNull();
	});

	it("returns digest_1.gif for digest level 1", () => {
		const result = getDigestIconSrc(1);
		expect(result).toContain("digest_1.gif");
	});

	it("returns digest_2.gif for digest level 2", () => {
		const result = getDigestIconSrc(2);
		expect(result).toContain("digest_2.gif");
	});

	it("returns digest_3.gif for digest level 3", () => {
		const result = getDigestIconSrc(3);
		expect(result).toContain("digest_3.gif");
	});

	it("caps digest level at 3", () => {
		const result = getDigestIconSrc(5);
		expect(result).toContain("digest_3.gif");
	});

	it("returns CDN URL", () => {
		const result = getDigestIconSrc(1);
		expect(result).toContain("https://t.no.mt/static/image/common/");
	});
});

// ---------------------------------------------------------------------------
// getNewbieStampSrc
// ---------------------------------------------------------------------------

describe("getNewbieStampSrc", () => {
	it("returns null for non-first thread", () => {
		expect(getNewbieStampSrc(false)).toBeNull();
	});

	it("returns stamp URL for first thread", () => {
		const result = getNewbieStampSrc(true);
		expect(result).toContain("011.small.gif");
	});

	it("returns CDN stamp path (not common)", () => {
		const result = getNewbieStampSrc(true);
		expect(result).toContain("https://t.no.mt/static/image/stamp/");
		expect(result).not.toContain("/common/");
	});
});

// ---------------------------------------------------------------------------
// filterIconRedundantBadges
// ---------------------------------------------------------------------------

describe("filterIconRedundantBadges", () => {
	it("removes sticky badge (already shown by pin icon)", () => {
		const thread = makeThread({ id: 1, sticky: StickyLevel.Global });
		const badges = getThreadBadges(thread);
		expect(badges.some((b) => b.type === "sticky")).toBe(true);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered.some((b) => b.type === "sticky")).toBe(false);
	});

	it("removes digest badge (already shown by digest icon)", () => {
		const thread = makeThread({ id: 1, digest: 2 });
		const badges = getThreadBadges(thread);
		expect(badges.some((b) => b.type === "digest")).toBe(true);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered.some((b) => b.type === "digest")).toBe(false);
	});

	it("removes closed badge (already shown by folder_lock icon)", () => {
		const thread = makeThread({ id: 1, closed: 1 });
		const badges = getThreadBadges(thread);
		expect(badges.some((b) => b.type === "closed")).toBe(true);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered.some((b) => b.type === "closed")).toBe(false);
	});

	it("removes special badge (already shown by special icon)", () => {
		const thread = makeThread({ id: 1, special: 1 });
		const badges = getThreadBadges(thread);
		expect(badges.some((b) => b.type === "special")).toBe(true);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered.some((b) => b.type === "special")).toBe(false);
	});

	it("keeps typeName badge (no icon equivalent)", () => {
		const thread = makeThread({ id: 1, typeName: "讨论", sticky: StickyLevel.Forum });
		const badges = getThreadBadges(thread);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered.some((b) => b.type === "typeName")).toBe(true);
		expect(filtered.some((b) => b.type === "sticky")).toBe(false);
	});

	it("returns empty array when all badges are icon-represented", () => {
		const thread = makeThread({ id: 1, sticky: StickyLevel.Forum, digest: 1 });
		const badges = getThreadBadges(thread);
		const filtered = filterIconRedundantBadges(badges);
		expect(filtered).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// getThreadPageCount
// ---------------------------------------------------------------------------

describe("getThreadPageCount", () => {
	it("returns 1 for thread with 0 replies (OP only)", () => {
		expect(getThreadPageCount(0, 20)).toBe(1);
	});

	it("returns 1 for thread with replies fitting in one page", () => {
		expect(getThreadPageCount(19, 20)).toBe(1);
	});

	it("returns 2 when replies + OP span 2 pages", () => {
		// 20 replies + 1 OP = 21 posts → ceil(21/20) = 2
		expect(getThreadPageCount(20, 20)).toBe(2);
	});

	it("returns correct count for large thread", () => {
		// 199 replies + 1 OP = 200 posts → ceil(200/20) = 10
		expect(getThreadPageCount(199, 20)).toBe(10);
	});

	it("handles non-20 postsPerPage", () => {
		// 50 replies + 1 OP = 51 posts → ceil(51/10) = 6
		expect(getThreadPageCount(50, 10)).toBe(6);
	});

	it("returns 1 when postsPerPage is 0 (guard)", () => {
		expect(getThreadPageCount(100, 0)).toBe(1);
	});

	it("returns 1 when postsPerPage is negative (guard)", () => {
		expect(getThreadPageCount(100, -5)).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// getInlinePageItems
// ---------------------------------------------------------------------------

describe("getInlinePageItems", () => {
	it("returns empty for single-page thread", () => {
		expect(getInlinePageItems(1)).toEqual([]);
	});

	it("returns [...,2] for 2-page thread", () => {
		expect(getInlinePageItems(2)).toEqual(["ellipsis", 2]);
	});

	it("returns [...,2,3,4] for 4-page thread", () => {
		expect(getInlinePageItems(4)).toEqual(["ellipsis", 2, 3, 4]);
	});

	it("returns [...,2,3,4,5,6] for 6-page thread (all shown)", () => {
		expect(getInlinePageItems(6)).toEqual(["ellipsis", 2, 3, 4, 5, 6]);
	});

	it("returns [...,2,3,4,5,...,7] for 7-page thread (trailing ellipsis)", () => {
		expect(getInlinePageItems(7)).toEqual(["ellipsis", 2, 3, 4, 5, "ellipsis", 7]);
	});

	it("returns [...,2,3,4,5,...,100] for 100-page thread", () => {
		expect(getInlinePageItems(100)).toEqual(["ellipsis", 2, 3, 4, 5, "ellipsis", 100]);
	});
});

// ---------------------------------------------------------------------------
// pageToPostCursor
// ---------------------------------------------------------------------------

describe("pageToPostCursor", () => {
	it("returns null for page 1 (first page uses no cursor)", () => {
		expect(pageToPostCursor(1, 20)).toBeNull();
	});

	it("returns null for page 0", () => {
		expect(pageToPostCursor(0, 20)).toBeNull();
	});

	it("returns cursor with position=20 for page 2 (postsPerPage=20)", () => {
		const cursor = pageToPostCursor(2, 20);
		expect(cursor).not.toBeNull();
		const payload = JSON.parse(atob(cursor as string));
		expect(payload.position).toBe(20);
	});

	it("returns cursor with position=40 for page 3 (postsPerPage=20)", () => {
		const cursor = pageToPostCursor(3, 20);
		const payload = JSON.parse(atob(cursor as string));
		expect(payload.position).toBe(40);
	});

	it("respects custom postsPerPage", () => {
		const cursor = pageToPostCursor(2, 50);
		const payload = JSON.parse(atob(cursor as string));
		expect(payload.position).toBe(50);
	});
});

// ---------------------------------------------------------------------------
// getThreadPageUrl
// ---------------------------------------------------------------------------

describe("getThreadPageUrl", () => {
	it("returns /threads/{id} for page 1", () => {
		expect(getThreadPageUrl(123, 1)).toBe("/threads/123");
	});

	it("returns /threads/{id}?page=N for page > 1", () => {
		expect(getThreadPageUrl(123, 2)).toBe("/threads/123?page=2");
		expect(getThreadPageUrl(456, 5)).toBe("/threads/456?page=5");
	});

	it("appends returnTo when provided (page 1)", () => {
		expect(getThreadPageUrl(123, 1, "/forums/5?page=4")).toBe(
			"/threads/123?returnTo=%2Fforums%2F5%3Fpage%3D4",
		);
	});

	it("appends returnTo alongside page param", () => {
		const url = getThreadPageUrl(123, 3, "/forums/5");
		expect(url).toContain("page=3");
		expect(url).toContain("returnTo=%2Fforums%2F5");
	});

	it("omits returnTo when undefined", () => {
		expect(getThreadPageUrl(123, 2, undefined)).toBe("/threads/123?page=2");
	});
});

// ---------------------------------------------------------------------------
// resolveThreadPostCursor
// ---------------------------------------------------------------------------

describe("resolveThreadPostCursor", () => {
	const ppp = 20; // postsPerPage

	it("returns no cursor for first page (no params)", () => {
		const result = resolveThreadPostCursor({}, ppp);
		expect(result).toEqual({ cursor: undefined, isLastPage: false });
	});

	it("returns no cursor for page=1", () => {
		const result = resolveThreadPostCursor({ page: "1" }, ppp);
		expect(result).toEqual({ cursor: undefined, isLastPage: false });
	});

	it("converts page=2 to position cursor", () => {
		const result = resolveThreadPostCursor({ page: "2" }, ppp);
		expect(result.isLastPage).toBe(false);
		expect(result.cursor).toBeDefined();
		const payload = JSON.parse(atob(result.cursor as string));
		expect(payload.position).toBe(20);
	});

	it("converts page=3 to position cursor", () => {
		const result = resolveThreadPostCursor({ page: "3" }, ppp);
		const payload = JSON.parse(atob(result.cursor as string));
		expect(payload.position).toBe(40);
	});

	it("explicit cursor takes priority over page", () => {
		const result = resolveThreadPostCursor({ cursor: "abc123", page: "5" }, ppp);
		expect(result.cursor).toBe("abc123");
		expect(result.isLastPage).toBe(false);
	});

	it("last=1 takes priority over page", () => {
		const result = resolveThreadPostCursor({ last: "1", page: "3" }, ppp);
		expect(result.cursor).toBeUndefined();
		expect(result.isLastPage).toBe(true);
	});

	it("last=0 does NOT suppress page (only last=1 is the flag)", () => {
		const result = resolveThreadPostCursor({ last: "0", page: "2" }, ppp);
		expect(result.isLastPage).toBe(false);
		expect(result.cursor).toBeDefined();
		const payload = JSON.parse(atob(result.cursor as string));
		expect(payload.position).toBe(20);
	});

	it("explicit cursor takes priority over last=1", () => {
		const result = resolveThreadPostCursor({ cursor: "abc", last: "1" }, ppp);
		expect(result.cursor).toBe("abc");
		expect(result.isLastPage).toBe(false);
	});

	it("ignores invalid page value", () => {
		const result = resolveThreadPostCursor({ page: "abc" }, ppp);
		expect(result).toEqual({ cursor: undefined, isLastPage: false });
	});
});

// ---------------------------------------------------------------------------
// cursorToPage
// ---------------------------------------------------------------------------

describe("cursorToPage", () => {
	const ppp = 20;

	it("returns page 1 for position 0", () => {
		const cursor = btoa(JSON.stringify({ position: 0 }));
		expect(cursorToPage(cursor, ppp)).toBe(1);
	});

	it("returns page 2 for position 20", () => {
		const cursor = btoa(JSON.stringify({ position: 20 }));
		expect(cursorToPage(cursor, ppp)).toBe(2);
	});

	it("returns page 3 for position 40", () => {
		const cursor = btoa(JSON.stringify({ position: 40 }));
		expect(cursorToPage(cursor, ppp)).toBe(3);
	});

	it("round-trips with pageToPostCursor", () => {
		for (const page of [2, 3, 5, 10]) {
			const cursor = pageToPostCursor(page, ppp);
			expect(cursor).not.toBeNull();
			expect(cursorToPage(cursor as string, ppp)).toBe(page);
		}
	});

	it("returns 1 for invalid base64", () => {
		expect(cursorToPage("not-base64!!!", ppp)).toBe(1);
	});

	it("returns 1 for missing position field", () => {
		const cursor = btoa(JSON.stringify({ offset: 40 }));
		expect(cursorToPage(cursor, ppp)).toBe(1);
	});

	it("returns 1 for negative position", () => {
		const cursor = btoa(JSON.stringify({ position: -20 }));
		expect(cursorToPage(cursor, ppp)).toBe(1);
	});

	it("returns 1 when postsPerPage is 0", () => {
		const cursor = btoa(JSON.stringify({ position: 20 }));
		expect(cursorToPage(cursor, 0)).toBe(1);
	});

	it("handles mid-page position (floors to page)", () => {
		// position 25 with ppp=20 → floor(25/20)+1 = 2
		const cursor = btoa(JSON.stringify({ position: 25 }));
		expect(cursorToPage(cursor, ppp)).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// resolveCurrentPage
// ---------------------------------------------------------------------------

describe("resolveCurrentPage", () => {
	const ppp = 20;
	const totalPages = 10;

	it("returns 1 for no params (default first page)", () => {
		expect(resolveCurrentPage({}, ppp, totalPages)).toBe(1);
	});

	it("returns page number from ?page=N", () => {
		expect(resolveCurrentPage({ page: "3" }, ppp, totalPages)).toBe(3);
	});

	it("clamps page above totalPages", () => {
		expect(resolveCurrentPage({ page: "99" }, ppp, totalPages)).toBe(totalPages);
	});

	it("clamps page below 1", () => {
		expect(resolveCurrentPage({ page: "0" }, ppp, totalPages)).toBe(1);
		expect(resolveCurrentPage({ page: "-1" }, ppp, totalPages)).toBe(1);
	});

	it("returns totalPages for ?last=1", () => {
		expect(resolveCurrentPage({ last: "1" }, ppp, totalPages)).toBe(totalPages);
	});

	it("last=1 takes priority over ?page", () => {
		expect(resolveCurrentPage({ last: "1", page: "3" }, ppp, totalPages)).toBe(totalPages);
	});

	it("cursor takes priority over last and page", () => {
		// cursor with position=40 → page 3
		const cursor = btoa(JSON.stringify({ position: 40 }));
		expect(resolveCurrentPage({ cursor, last: "1", page: "5" }, ppp, totalPages)).toBe(3);
	});

	it("cursor page is clamped to totalPages", () => {
		const cursor = btoa(JSON.stringify({ position: 999 }));
		expect(resolveCurrentPage({ cursor }, ppp, totalPages)).toBe(totalPages);
	});

	it("invalid page string falls through to default", () => {
		expect(resolveCurrentPage({ page: "abc" }, ppp, totalPages)).toBe(1);
	});

	it("page=1 returns 1", () => {
		expect(resolveCurrentPage({ page: "1" }, ppp, totalPages)).toBe(1);
	});

	// --- Bug scenario tests ---

	it("first page: prevHref should be null (page=1)", () => {
		const page = resolveCurrentPage({}, ppp, totalPages);
		expect(page).toBe(1);
		// page > 1 is false → prev disabled
		expect(page > 1).toBe(false);
	});

	it("middle page: both prev and next available", () => {
		const page = resolveCurrentPage({ page: "5" }, ppp, totalPages);
		expect(page).toBe(5);
		expect(page > 1).toBe(true); // prev available
		expect(page < totalPages).toBe(true); // next available
	});

	it("last page: prev available, next disabled", () => {
		const page = resolveCurrentPage({ page: "10" }, ppp, totalPages);
		expect(page).toBe(10);
		expect(page > 1).toBe(true); // prev available
		expect(page < totalPages).toBe(false); // next disabled
	});

	it("last=1 gives last page with prev available", () => {
		const page = resolveCurrentPage({ last: "1" }, ppp, totalPages);
		expect(page).toBe(totalPages);
		expect(page > 1).toBe(true); // prev available
	});
});

// ---------------------------------------------------------------------------
// validateReturnTo
// ---------------------------------------------------------------------------

describe("validateReturnTo", () => {
	const forumId = 5;

	it("returns null for undefined returnTo", () => {
		expect(validateReturnTo(undefined, forumId)).toBeNull();
	});

	it("accepts /forums/{forumId} (exact match)", () => {
		expect(validateReturnTo("/forums/5", forumId)).toBe("/forums/5");
	});

	it("accepts /forums/{forumId}?page=N", () => {
		expect(validateReturnTo("/forums/5?page=4", forumId)).toBe("/forums/5?page=4");
	});

	it("accepts /forums/{forumId}?page=1", () => {
		expect(validateReturnTo("/forums/5?page=1", forumId)).toBe("/forums/5?page=1");
	});

	it("rejects wrong forum ID", () => {
		expect(validateReturnTo("/forums/99", forumId)).toBeNull();
		expect(validateReturnTo("/forums/99?page=2", forumId)).toBeNull();
	});

	it("rejects external URLs", () => {
		expect(validateReturnTo("https://evil.com", forumId)).toBeNull();
	});

	it("rejects paths outside /forums/", () => {
		expect(validateReturnTo("/users/1", forumId)).toBeNull();
		expect(validateReturnTo("/", forumId)).toBeNull();
	});

	it("rejects /forums/{forumId} with extra params beyond page", () => {
		expect(validateReturnTo("/forums/5?page=2&evil=1", forumId)).toBeNull();
	});

	it("rejects non-numeric page values", () => {
		expect(validateReturnTo("/forums/5?page=abc", forumId)).toBeNull();
	});

	it("rejects page=0", () => {
		expect(validateReturnTo("/forums/5?page=0", forumId)).toBeNull();
	});

	it("rejects page with negative value", () => {
		expect(validateReturnTo("/forums/5?page=-1", forumId)).toBeNull();
	});

	it("rejects empty string", () => {
		expect(validateReturnTo("", forumId)).toBeNull();
	});
});
