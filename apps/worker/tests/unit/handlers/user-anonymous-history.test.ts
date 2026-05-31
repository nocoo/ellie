import { describe, expect, it } from "vitest";
import { anonymousHistoryFilter } from "../../../src/handlers/user";

describe("user.ts — anonymousHistoryFilter contract", () => {
	const PROFILE = 340271;

	it("excludes anonymous rows for an anonymous viewer", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, null)).toBe("p.anonymous = 0");
	});

	it("excludes anonymous rows for an unrelated logged-in member", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, { userId: 999, role: 0 })).toBe(
			"p.anonymous = 0",
		);
	});

	it("includes everything for the profile owner viewing their own history", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, { userId: PROFILE, role: 0 })).toBe(
			"1=1",
		);
	});

	it("includes everything for staff (Admin)", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, { userId: 999, role: 1 })).toBe("1=1");
	});

	it("includes everything for staff (SuperMod)", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, { userId: 999, role: 2 })).toBe("1=1");
	});

	it("includes everything for staff (Mod)", () => {
		expect(anonymousHistoryFilter("p.anonymous", PROFILE, { userId: 999, role: 3 })).toBe("1=1");
	});

	it("works on thread-level column too", () => {
		expect(anonymousHistoryFilter("t.anonymous_author", PROFILE, null)).toBe(
			"t.anonymous_author = 0",
		);
		expect(
			anonymousHistoryFilter("t.anonymous_author", PROFILE, { userId: PROFILE, role: 0 }),
		).toBe("1=1");
	});
});
