import { describe, expect, test } from "bun:test";
import {
	type HighlightStyle,
	type ThreadBadge,
	decodeHighlight,
	getThreadBadges,
} from "@/models/thread";
import type { Thread } from "@/models/types";
import { StickyLevel } from "@/models/types";

// ─── Fixture ────────────────────────────────────────────

function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: 1,
		forumId: 1,
		authorId: 1,
		authorName: "testuser",
		subject: "Test Thread",
		createdAt: 1000000,
		lastPostAt: 2000000,
		lastPoster: "testuser",
		replies: 0,
		views: 0,
		closed: 0,
		sticky: StickyLevel.None,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		...overrides,
	};
}

function findBadge(badges: ThreadBadge[], type: string): ThreadBadge | undefined {
	return badges.find((b) => b.type === type);
}

// ─── getThreadBadges: sticky ────────────────────────────

describe("getThreadBadges — sticky", () => {
	test("no sticky → no sticky badge", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.None }));
		expect(findBadge(badges, "sticky")).toBeUndefined();
	});

	test("global sticky → 全局置顶 destructive", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Global }));
		const badge = findBadge(badges, "sticky");
		expect(badge).toBeDefined();
		expect(badge?.label).toBe("全局置顶");
		expect(badge?.variant).toBe("destructive");
	});

	test("category sticky → 分类置顶 warning", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Category }));
		const badge = findBadge(badges, "sticky");
		expect(badge).toBeDefined();
		expect(badge?.label).toBe("分类置顶");
		expect(badge?.variant).toBe("warning");
	});

	test("forum sticky → 置顶 default", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Forum }));
		const badge = findBadge(badges, "sticky");
		expect(badge).toBeDefined();
		expect(badge?.label).toBe("置顶");
		expect(badge?.variant).toBe("default");
	});
});

// ─── getThreadBadges: digest ────────────────────────────

describe("getThreadBadges — digest", () => {
	test("digest=0 → no digest badge", () => {
		const badges = getThreadBadges(makeThread({ digest: 0 }));
		expect(findBadge(badges, "digest")).toBeUndefined();
	});

	test("digest=1 → 精华 (no level suffix)", () => {
		const badges = getThreadBadges(makeThread({ digest: 1 }));
		const badge = findBadge(badges, "digest");
		expect(badge).toBeDefined();
		expect(badge?.label).toBe("精华");
		expect(badge?.variant).toBe("success");
	});

	test("digest=2 → 精华 II", () => {
		const badges = getThreadBadges(makeThread({ digest: 2 }));
		const badge = findBadge(badges, "digest");
		expect(badge?.label).toBe("精华 II");
	});

	test("digest=3 → 精华 III", () => {
		const badges = getThreadBadges(makeThread({ digest: 3 }));
		const badge = findBadge(badges, "digest");
		expect(badge?.label).toBe("精华 III");
	});
});

// ─── getThreadBadges: closed ────────────────────────────

describe("getThreadBadges — closed", () => {
	test("closed=0 → no closed badge", () => {
		const badges = getThreadBadges(makeThread({ closed: 0 }));
		expect(findBadge(badges, "closed")).toBeUndefined();
	});

	test("closed=1 → 锁定 secondary", () => {
		const badges = getThreadBadges(makeThread({ closed: 1 }));
		const badge = findBadge(badges, "closed");
		expect(badge).toBeDefined();
		expect(badge?.label).toBe("锁定");
		expect(badge?.variant).toBe("secondary");
	});
});

// ─── getThreadBadges: special ───────────────────────────

describe("getThreadBadges — special", () => {
	test("special=0 → no special badge", () => {
		const badges = getThreadBadges(makeThread({ special: 0 }));
		expect(findBadge(badges, "special")).toBeUndefined();
	});

	const specialCases = [
		[1, "投票", "default"],
		[2, "交易", "warning"],
		[3, "悬赏", "warning"],
		[4, "活动", "default"],
		[5, "辩论", "default"],
	] as const;

	for (const [val, label, variant] of specialCases) {
		test(`special=${val} → ${label} ${variant}`, () => {
			const badges = getThreadBadges(makeThread({ special: val }));
			const badge = findBadge(badges, "special");
			expect(badge).toBeDefined();
			expect(badge?.label).toBe(label);
			expect(badge?.variant).toBe(variant);
		});
	}

	test("unknown special=99 → no special badge", () => {
		const badges = getThreadBadges(makeThread({ special: 99 }));
		expect(findBadge(badges, "special")).toBeUndefined();
	});
});

// ─── getThreadBadges: combinations ──────────────────────

describe("getThreadBadges — combinations", () => {
	test("global sticky + digest + closed + special", () => {
		const badges = getThreadBadges(
			makeThread({
				sticky: StickyLevel.Global,
				digest: 2,
				closed: 1,
				special: 1,
			}),
		);
		expect(badges).toHaveLength(4);
		expect(badges.map((b) => b.type)).toEqual(["sticky", "digest", "closed", "special"]);
	});

	test("plain thread → empty badges", () => {
		const badges = getThreadBadges(makeThread());
		expect(badges).toHaveLength(0);
	});

	test("sticky + digest only", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Forum, digest: 1 }));
		expect(badges).toHaveLength(2);
		expect(badges[0].type).toBe("sticky");
		expect(badges[1].type).toBe("digest");
	});
});

// ─── decodeHighlight ────────────────────────────────────

describe("decodeHighlight", () => {
	test("highlight=0 → null", () => {
		expect(decodeHighlight(0)).toBeNull();
	});

	test("pure red color (0xFF0000)", () => {
		const result = decodeHighlight(0xff0000);
		expect(result).toEqual({
			color: "#ff0000",
			bold: false,
			italic: false,
			underline: false,
		} satisfies HighlightStyle);
	});

	test("pure green color (0x00FF00)", () => {
		const result = decodeHighlight(0x00ff00);
		expect(result).toEqual({
			color: "#00ff00",
			bold: false,
			italic: false,
			underline: false,
		});
	});

	test("bold only (bit 24)", () => {
		const result = decodeHighlight(1 << 24);
		expect(result).toEqual({
			color: null,
			bold: true,
			italic: false,
			underline: false,
		});
	});

	test("italic only (bit 25)", () => {
		const result = decodeHighlight(1 << 25);
		expect(result).toEqual({
			color: null,
			bold: false,
			italic: true,
			underline: false,
		});
	});

	test("underline only (bit 26)", () => {
		const result = decodeHighlight(1 << 26);
		expect(result).toEqual({
			color: null,
			bold: false,
			italic: false,
			underline: true,
		});
	});

	test("color + bold + italic", () => {
		const highlight = 0x336699 | (1 << 24) | (1 << 25);
		const result = decodeHighlight(highlight);
		expect(result).toEqual({
			color: "#336699",
			bold: true,
			italic: true,
			underline: false,
		});
	});

	test("all flags + color", () => {
		const highlight = 0xaabbcc | (1 << 24) | (1 << 25) | (1 << 26);
		const result = decodeHighlight(highlight);
		expect(result).toEqual({
			color: "#aabbcc",
			bold: true,
			italic: true,
			underline: true,
		});
	});

	test("color with leading zeros (0x000123)", () => {
		const result = decodeHighlight(0x000123);
		expect(result).toEqual({
			color: "#000123",
			bold: false,
			italic: false,
			underline: false,
		});
	});
});
