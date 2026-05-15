import type { Thread } from "@ellie/types";
import { StickyLevel, decodeHighlight, getThreadBadges } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: 1,
		forumId: 1,
		authorId: 1,
		authorName: "alice",
		authorAvatar: "",
		authorAvatarPath: "",
		subject: "Test Thread",
		createdAt: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		replies: 0,
		views: 0,
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
// getThreadBadges
// ---------------------------------------------------------------------------

describe("getThreadBadges", () => {
	it("returns empty array for plain thread", () => {
		const badges = getThreadBadges(makeThread());
		expect(badges).toEqual([]);
	});

	it("includes typeName badge first", () => {
		const badges = getThreadBadges(makeThread({ typeName: "讨论" }));
		expect(badges[0]).toEqual({ type: "typeName", label: "讨论", variant: "secondary" });
	});

	it("includes global sticky badge", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Global }));
		expect(badges).toContainEqual({ type: "sticky", label: "全局置顶", variant: "destructive" });
	});

	it("includes category sticky badge", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Category }));
		expect(badges).toContainEqual({ type: "sticky", label: "分类置顶", variant: "warning" });
	});

	it("includes forum sticky badge", () => {
		const badges = getThreadBadges(makeThread({ sticky: StickyLevel.Forum }));
		expect(badges).toContainEqual({ type: "sticky", label: "置顶", variant: "default" });
	});

	it("includes digest badge level 1 (no level suffix)", () => {
		const badges = getThreadBadges(makeThread({ digest: 1 }));
		expect(badges).toContainEqual({ type: "digest", label: "精华", variant: "success" });
	});

	it("includes digest badge level 2 with roman numeral", () => {
		const badges = getThreadBadges(makeThread({ digest: 2 }));
		expect(badges).toContainEqual({ type: "digest", label: "精华 II", variant: "success" });
	});

	it("includes digest badge level 3 with roman numeral", () => {
		const badges = getThreadBadges(makeThread({ digest: 3 }));
		expect(badges).toContainEqual({ type: "digest", label: "精华 III", variant: "success" });
	});

	it("includes closed badge", () => {
		const badges = getThreadBadges(makeThread({ closed: 1 }));
		expect(badges).toContainEqual({ type: "closed", label: "锁定", variant: "secondary" });
	});

	it("includes special type badges", () => {
		expect(getThreadBadges(makeThread({ special: 1 }))).toContainEqual({
			type: "special",
			label: "投票",
			variant: "default",
		});
		expect(getThreadBadges(makeThread({ special: 2 }))).toContainEqual({
			type: "special",
			label: "交易",
			variant: "warning",
		});
		expect(getThreadBadges(makeThread({ special: 3 }))).toContainEqual({
			type: "special",
			label: "悬赏",
			variant: "warning",
		});
		expect(getThreadBadges(makeThread({ special: 4 }))).toContainEqual({
			type: "special",
			label: "活动",
			variant: "default",
		});
		expect(getThreadBadges(makeThread({ special: 5 }))).toContainEqual({
			type: "special",
			label: "辩论",
			variant: "default",
		});
	});

	it("does not include special badge for unknown special values", () => {
		const badges = getThreadBadges(makeThread({ special: 99 }));
		expect(badges.find((b) => b.type === "special")).toBeUndefined();
	});

	it("badge order: typeName → sticky → digest → closed → special", () => {
		const thread = makeThread({
			typeName: "讨论",
			sticky: StickyLevel.Global,
			digest: 2,
			closed: 1,
			special: 1,
		});
		const badges = getThreadBadges(thread);
		const types = badges.map((b) => b.type);
		expect(types).toEqual(["typeName", "sticky", "digest", "closed", "special"]);
	});

	// -----------------------------------------------------------------------
	// includeTypeNameBadge option (forum-level prefix switch)
	// -----------------------------------------------------------------------

	describe("includeTypeNameBadge option", () => {
		it("defaults to true — typeName badge is included when omitted", () => {
			const badges = getThreadBadges(makeThread({ typeName: "讨论" }));
			expect(badges[0]).toEqual({ type: "typeName", label: "讨论", variant: "secondary" });
		});

		it("explicit true keeps typeName badge", () => {
			const badges = getThreadBadges(makeThread({ typeName: "讨论" }), {
				includeTypeNameBadge: true,
			});
			expect(badges.find((b) => b.type === "typeName")).toBeDefined();
		});

		it("explicit false suppresses typeName badge but keeps the rest", () => {
			const thread = makeThread({
				typeName: "讨论",
				sticky: StickyLevel.Forum,
				digest: 1,
			});
			const badges = getThreadBadges(thread, { includeTypeNameBadge: false });
			const types = badges.map((b) => b.type);
			expect(types).not.toContain("typeName");
			expect(types).toContain("sticky");
			expect(types).toContain("digest");
		});

		it("false with empty typeName is a no-op (no badge anyway)", () => {
			const badges = getThreadBadges(makeThread({ typeName: "" }), {
				includeTypeNameBadge: false,
			});
			expect(badges.find((b) => b.type === "typeName")).toBeUndefined();
		});

		it("true preserves historical disabled/tombstone denorm typeName", () => {
			// thread.typeName is the only source of truth for historical
			// categories — even if the corresponding row was disabled or
			// deleted, the prefix badge keeps showing via the denorm field.
			const badges = getThreadBadges(makeThread({ typeName: "已停用分类" }), {
				includeTypeNameBadge: true,
			});
			expect(badges[0]).toEqual({
				type: "typeName",
				label: "已停用分类",
				variant: "secondary",
			});
		});
	});
});

// ---------------------------------------------------------------------------
// decodeHighlight
// ---------------------------------------------------------------------------

describe("decodeHighlight", () => {
	it("returns null for highlight === 0", () => {
		expect(decodeHighlight(0)).toBeNull();
	});

	it("decodes color only (no flags)", () => {
		const result = decodeHighlight(0xff0000); // red
		expect(result).toEqual({ color: "#ff0000", bold: false, italic: false, underline: false });
	});

	it("decodes blue color", () => {
		const result = decodeHighlight(0x0000ff);
		expect(result).toEqual({ color: "#0000ff", bold: false, italic: false, underline: false });
	});

	it("decodes bold flag (bit 24)", () => {
		const result = decodeHighlight(1 << 24);
		expect(result).toEqual({ color: null, bold: true, italic: false, underline: false });
	});

	it("decodes italic flag (bit 25)", () => {
		const result = decodeHighlight(1 << 25);
		expect(result).toEqual({ color: null, bold: false, italic: true, underline: false });
	});

	it("decodes underline flag (bit 26)", () => {
		const result = decodeHighlight(1 << 26);
		expect(result).toEqual({ color: null, bold: false, italic: false, underline: true });
	});

	it("decodes color + all flags combined", () => {
		const highlight = 0x336699 | (1 << 24) | (1 << 25) | (1 << 26);
		const result = decodeHighlight(highlight);
		expect(result).toEqual({ color: "#336699", bold: true, italic: true, underline: true });
	});

	it("pads color to 6 hex digits", () => {
		const result = decodeHighlight(0x000001); // very small color value
		expect(result?.color).toBe("#000001");
	});

	it("handles color bits = 0 but flags set → color null", () => {
		const highlight = (1 << 24) | (1 << 25); // bold + italic, no color
		const result = decodeHighlight(highlight);
		expect(result?.color).toBeNull();
	});
});
