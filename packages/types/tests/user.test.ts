import { isUserBanned, isUserMuted, UserStatus } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// isUserMuted
// ---------------------------------------------------------------------------

describe("isUserMuted", () => {
	it("returns true for UserStatus.Archived (-2)", () => {
		expect(isUserMuted(UserStatus.Archived)).toBe(true);
		expect(isUserMuted(-2)).toBe(true);
	});

	it("returns false for other status values", () => {
		expect(isUserMuted(UserStatus.Active)).toBe(false);
		expect(isUserMuted(UserStatus.Banned)).toBe(false);
		expect(isUserMuted(UserStatus.Placeholder)).toBe(false);
		expect(isUserMuted(0)).toBe(false);
		expect(isUserMuted(1)).toBe(false);
	});

	it("returns false for null", () => {
		expect(isUserMuted(null)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isUserBanned
// ---------------------------------------------------------------------------

describe("isUserBanned", () => {
	it("returns true for UserStatus.Banned (-1)", () => {
		expect(isUserBanned(UserStatus.Banned)).toBe(true);
		expect(isUserBanned(-1)).toBe(true);
	});

	it("returns false for other status values", () => {
		expect(isUserBanned(UserStatus.Active)).toBe(false);
		expect(isUserBanned(UserStatus.Archived)).toBe(false);
		expect(isUserBanned(UserStatus.Placeholder)).toBe(false);
		expect(isUserBanned(0)).toBe(false);
		expect(isUserBanned(1)).toBe(false);
	});

	it("returns false for null", () => {
		expect(isUserBanned(null)).toBe(false);
	});
});
