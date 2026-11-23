import { describe, expect, it } from "vitest";
import {
	censorActionVariant,
	FIRST_POST_VARIANT,
	forumStatusVariant,
	forumTypeVariant,
	ipBanExpiryVariant,
	ipBanStateVariant,
	reportStatusVariant,
	reportTypeVariant,
	STATISTICS_DONE_VARIANT,
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
	userRoleVariant,
	userStatusVariant,
} from "@/viewmodels/admin/badges";

// The whole point of badges.ts is to keep status colours consistent and
// stop pills rendering as transparent/white. These tests lock the
// mapping so a future refactor doesn't silently re-introduce `outline`
// for state.

describe("badges — userStatusVariant", () => {
	it("normal user → success", () => {
		expect(userStatusVariant(1)).toBe("success");
	});
	it("banned user → danger", () => {
		expect(userStatusVariant(-1)).toBe("danger");
	});
	it("archived user → neutral", () => {
		expect(userStatusVariant(-2)).toBe("neutral");
	});
	it("tombstone user → neutral (not outline)", () => {
		expect(userStatusVariant(-99)).toBe("neutral");
	});
	it("unknown status falls through to success default", () => {
		expect(userStatusVariant(0)).toBe("success");
		expect(userStatusVariant(99)).toBe("success");
	});
});

describe("badges — userRoleVariant", () => {
	it("admin → danger", () => {
		expect(userRoleVariant(1)).toBe("danger");
	});
	it("supermod → warning", () => {
		expect(userRoleVariant(2)).toBe("warning");
	});
	it("mod → info", () => {
		expect(userRoleVariant(3)).toBe("info");
	});
	it("regular member → neutral (visible, not outline)", () => {
		expect(userRoleVariant(0)).toBe("neutral");
		expect(userRoleVariant(99)).toBe("neutral");
	});
});

describe("badges — thread flag variants", () => {
	it("sticky >0 → warning, 0 → neutral", () => {
		expect(threadStickyVariant(1)).toBe("warning");
		expect(threadStickyVariant(3)).toBe("warning");
		expect(threadStickyVariant(0)).toBe("neutral");
	});
	it("digest >0 → success, 0 → neutral", () => {
		expect(threadDigestVariant(2)).toBe("success");
		expect(threadDigestVariant(0)).toBe("neutral");
	});
	it("closed >0 → danger, 0 → neutral", () => {
		expect(threadClosedVariant(1)).toBe("danger");
		expect(threadClosedVariant(0)).toBe("neutral");
	});
	it("highlight >0 → info, 0 → neutral (encoded bitmask, any non-zero counts)", () => {
		expect(threadHighlightVariant(1)).toBe("info");
		// Real values are 24-bit RGB packs (e.g. 0xff0000 = 16711680).
		expect(threadHighlightVariant(16711680)).toBe("info");
		expect(threadHighlightVariant(0)).toBe("neutral");
	});
});

describe("badges — reportStatusVariant", () => {
	it("pending → warning (not raw yellow-100)", () => {
		expect(reportStatusVariant("pending")).toBe("warning");
	});
	it("resolved → success", () => {
		expect(reportStatusVariant("resolved")).toBe("success");
	});
	it("dismissed → neutral", () => {
		expect(reportStatusVariant("dismissed")).toBe("neutral");
	});
});

describe("badges — reportTypeVariant", () => {
	it("thread → info", () => {
		expect(reportTypeVariant("thread")).toBe("info");
	});
	it("post → neutral", () => {
		expect(reportTypeVariant("post")).toBe("neutral");
	});
	it("user → warning", () => {
		expect(reportTypeVariant("user")).toBe("warning");
	});
});

describe("badges — forumStatusVariant", () => {
	it("visible (1) → success", () => {
		expect(forumStatusVariant(1)).toBe("success");
	});
	it("hidden (0) → neutral", () => {
		expect(forumStatusVariant(0)).toBe("neutral");
	});
});

describe("badges — forumTypeVariant", () => {
	it("group → info", () => {
		expect(forumTypeVariant("group")).toBe("info");
	});
	it("forum → neutral", () => {
		expect(forumTypeVariant("forum")).toBe("neutral");
	});
	it("sub → neutral", () => {
		expect(forumTypeVariant("sub")).toBe("neutral");
	});
});

describe("badges — censorActionVariant", () => {
	it("ban → danger", () => {
		expect(censorActionVariant("ban")).toBe("danger");
	});
	it("replace → neutral (not outline)", () => {
		expect(censorActionVariant("replace")).toBe("neutral");
	});
});

describe("badges — ipBanStateVariant", () => {
	it("banned true → danger", () => {
		expect(ipBanStateVariant(true)).toBe("danger");
	});
	it("banned false → success (not outline)", () => {
		expect(ipBanStateVariant(false)).toBe("success");
	});
});

describe("badges — ipBanExpiryVariant", () => {
	it("permanent (no expiry) → warning", () => {
		expect(ipBanExpiryVariant(false)).toBe("warning");
	});
	it("with expiry → neutral", () => {
		expect(ipBanExpiryVariant(true)).toBe("neutral");
	});
});

describe("badges — fixed-marker constants", () => {
	it("first-post marker is info (highlighted)", () => {
		expect(FIRST_POST_VARIANT).toBe("info");
	});
	it("statistics done marker is success", () => {
		expect(STATISTICS_DONE_VARIANT).toBe("success");
	});
});
