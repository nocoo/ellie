import { describe, expect, it } from "bun:test";
import { computeAvatarPath } from "../../../src/lib/avatar-path";

describe("computeAvatarPath", () => {
	it("should pad small UIDs correctly", () => {
		// UID 12345 → padded to 000012345 → 000/01/23/45_avatar_big.jpg
		expect(computeAvatarPath(12345)).toBe("avatar/000/01/23/45_avatar_big.jpg");
	});

	it("should handle single-digit UID", () => {
		// UID 1 → padded to 000000001 → 000/00/00/01_avatar_big.jpg
		expect(computeAvatarPath(1)).toBe("avatar/000/00/00/01_avatar_big.jpg");
	});

	it("should handle UID 0", () => {
		// UID 0 → padded to 000000000 → 000/00/00/00_avatar_big.jpg
		expect(computeAvatarPath(0)).toBe("avatar/000/00/00/00_avatar_big.jpg");
	});

	it("should handle medium-sized UID", () => {
		// UID 123456789 → 123/45/67/89_avatar_big.jpg
		expect(computeAvatarPath(123456789)).toBe("avatar/123/45/67/89_avatar_big.jpg");
	});

	it("should handle large UID (9 digits)", () => {
		// UID 999999999 → 999/99/99/99_avatar_big.jpg
		expect(computeAvatarPath(999999999)).toBe("avatar/999/99/99/99_avatar_big.jpg");
	});

	it("should handle UID with trailing zeros", () => {
		// UID 100000 → padded to 000100000 → 000/10/00/00_avatar_big.jpg
		expect(computeAvatarPath(100000)).toBe("avatar/000/10/00/00_avatar_big.jpg");
	});

	it("should handle UID 10", () => {
		// UID 10 → padded to 000000010 → 000/00/00/10_avatar_big.jpg
		expect(computeAvatarPath(10)).toBe("avatar/000/00/00/10_avatar_big.jpg");
	});

	it("should handle UID 100", () => {
		// UID 100 → padded to 000000100 → 000/00/01/00_avatar_big.jpg
		expect(computeAvatarPath(100)).toBe("avatar/000/00/01/00_avatar_big.jpg");
	});

	it("should handle typical forum UID ranges", () => {
		// Common UID ranges in forums
		expect(computeAvatarPath(50000)).toBe("avatar/000/05/00/00_avatar_big.jpg");
		expect(computeAvatarPath(1500000)).toBe("avatar/001/50/00/00_avatar_big.jpg");
	});
});
