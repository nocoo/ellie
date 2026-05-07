import {
	FIRST_POST_VARIANT,
	STATISTICS_DONE_VARIANT,
	censorActionVariant,
	forumStatusVariant,
	forumTypeVariant,
	ipBanExpiryVariant,
	ipBanStateVariant,
	reportStatusVariant,
	reportTypeVariant,
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
	userRoleVariant,
	userStatusVariant,
} from "@/viewmodels/admin/badges";
import { describe, expect, it } from "vitest";

// The whole point of badges.ts is to keep status colours consistent and
// stop pills rendering as transparent/white. These tests lock the
// mapping so a future refactor doesn't silently re-introduce `outline`
// for state.

describe("badges — userStatusVariant", () => {
	it("normal user → success", () => {
		expect(userStatusVariant(1)).toBe("success");
	});
	it("banned user → destructive", () => {
		expect(userStatusVariant(-1)).toBe("destructive");
	});
	it("archived user → muted", () => {
		expect(userStatusVariant(-2)).toBe("muted");
	});
	it("tombstone user → muted (not outline)", () => {
		expect(userStatusVariant(-99)).toBe("muted");
	});
	it("unknown status falls through to success default", () => {
		expect(userStatusVariant(0)).toBe("success");
		expect(userStatusVariant(99)).toBe("success");
	});
});

describe("badges — userRoleVariant", () => {
	it("admin → destructive", () => {
		expect(userRoleVariant(1)).toBe("destructive");
	});
	it("supermod → warning", () => {
		expect(userRoleVariant(2)).toBe("warning");
	});
	it("mod → default", () => {
		expect(userRoleVariant(3)).toBe("default");
	});
	it("regular member → secondary (visible, not outline)", () => {
		expect(userRoleVariant(0)).toBe("secondary");
		expect(userRoleVariant(99)).toBe("secondary");
	});
});

describe("badges — thread flag variants", () => {
	it("sticky >0 → warning, 0 → muted", () => {
		expect(threadStickyVariant(1)).toBe("warning");
		expect(threadStickyVariant(3)).toBe("warning");
		expect(threadStickyVariant(0)).toBe("muted");
	});
	it("digest >0 → success, 0 → muted", () => {
		expect(threadDigestVariant(2)).toBe("success");
		expect(threadDigestVariant(0)).toBe("muted");
	});
	it("closed >0 → destructive, 0 → muted", () => {
		expect(threadClosedVariant(1)).toBe("destructive");
		expect(threadClosedVariant(0)).toBe("muted");
	});
	it("highlight >0 → default, 0 → muted (encoded bitmask, any non-zero counts)", () => {
		expect(threadHighlightVariant(1)).toBe("default");
		// Real values are 24-bit RGB packs (e.g. 0xff0000 = 16711680).
		expect(threadHighlightVariant(16711680)).toBe("default");
		expect(threadHighlightVariant(0)).toBe("muted");
	});
});

describe("badges — reportStatusVariant", () => {
	it("pending → warning (not raw yellow-100)", () => {
		expect(reportStatusVariant("pending")).toBe("warning");
	});
	it("resolved → success", () => {
		expect(reportStatusVariant("resolved")).toBe("success");
	});
	it("dismissed → muted", () => {
		expect(reportStatusVariant("dismissed")).toBe("muted");
	});
});

describe("badges — reportTypeVariant", () => {
	it("thread → default", () => {
		expect(reportTypeVariant("thread")).toBe("default");
	});
	it("post → secondary", () => {
		expect(reportTypeVariant("post")).toBe("secondary");
	});
	it("user → warning", () => {
		expect(reportTypeVariant("user")).toBe("warning");
	});
});

describe("badges — forumStatusVariant", () => {
	it("visible (1) → success", () => {
		expect(forumStatusVariant(1)).toBe("success");
	});
	it("hidden (0) → muted", () => {
		expect(forumStatusVariant(0)).toBe("muted");
	});
});

describe("badges — forumTypeVariant", () => {
	it("group → default", () => {
		expect(forumTypeVariant("group")).toBe("default");
	});
	it("forum → secondary", () => {
		expect(forumTypeVariant("forum")).toBe("secondary");
	});
	it("sub → muted", () => {
		expect(forumTypeVariant("sub")).toBe("muted");
	});
});

describe("badges — censorActionVariant", () => {
	it("ban → destructive", () => {
		expect(censorActionVariant("ban")).toBe("destructive");
	});
	it("replace → secondary (not outline)", () => {
		expect(censorActionVariant("replace")).toBe("secondary");
	});
});

describe("badges — ipBanStateVariant", () => {
	it("banned true → destructive", () => {
		expect(ipBanStateVariant(true)).toBe("destructive");
	});
	it("banned false → success (not outline)", () => {
		expect(ipBanStateVariant(false)).toBe("success");
	});
});

describe("badges — ipBanExpiryVariant", () => {
	it("permanent (no expiry) → warning", () => {
		expect(ipBanExpiryVariant(false)).toBe("warning");
	});
	it("with expiry → muted", () => {
		expect(ipBanExpiryVariant(true)).toBe("muted");
	});
});

describe("badges — fixed-marker constants", () => {
	it("first-post marker is default (highlighted)", () => {
		expect(FIRST_POST_VARIANT).toBe("default");
	});
	it("statistics done marker is success", () => {
		expect(STATISTICS_DONE_VARIANT).toBe("success");
	});
});
