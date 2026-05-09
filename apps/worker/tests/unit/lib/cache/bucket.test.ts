import { UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { computeViewerBucket, computeVisibilityBucket } from "../../../../src/lib/cache/bucket";

describe("cache/bucket — visibility bucket", () => {
	it("anon for not-logged-in", () => {
		expect(computeVisibilityBucket({ isLoggedIn: false, role: UserRole.User })).toBe("anon");
	});

	it("member for ordinary logged-in user", () => {
		expect(computeVisibilityBucket({ isLoggedIn: true, role: UserRole.User })).toBe("member");
	});

	it("staff for Mod and SuperMod (independent of admin)", () => {
		expect(computeVisibilityBucket({ isLoggedIn: true, role: UserRole.Mod })).toBe("staff");
		expect(computeVisibilityBucket({ isLoggedIn: true, role: UserRole.SuperMod })).toBe("staff");
	});

	it("admin for Admin only — never folded into staff", () => {
		expect(computeVisibilityBucket({ isLoggedIn: true, role: UserRole.Admin })).toBe("admin");
	});

	it("unknown logged-in role falls back to member", () => {
		// e.g. legacy DZ value 7
		expect(computeVisibilityBucket({ isLoggedIn: true, role: 7 as UserRole })).toBe("member");
	});
});

describe("cache/bucket — viewer bucket", () => {
	it("public for anon", () => {
		expect(computeViewerBucket({ isLoggedIn: false, role: UserRole.User })).toBe("public");
	});

	it("public for ordinary member", () => {
		expect(computeViewerBucket({ isLoggedIn: true, role: UserRole.User })).toBe("public");
	});

	it("staff for Mod / SuperMod / Admin", () => {
		expect(computeViewerBucket({ isLoggedIn: true, role: UserRole.Mod })).toBe("staff");
		expect(computeViewerBucket({ isLoggedIn: true, role: UserRole.SuperMod })).toBe("staff");
		expect(computeViewerBucket({ isLoggedIn: true, role: UserRole.Admin })).toBe("staff");
	});

	it("unknown role falls back to public", () => {
		expect(computeViewerBucket({ isLoggedIn: true, role: 99 as UserRole })).toBe("public");
	});
});
