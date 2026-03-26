import { describe, expect, test } from "bun:test";
import { formatFileSize, getFloorLabel } from "@/components/forum/post-card";
import { formatDate, getRoleLabel } from "@/components/forum/user-card";
import { UserRole } from "@/models/types";

describe("PostCard", () => {
	describe("getFloorLabel", () => {
		test("returns 1F for position 1", () => {
			expect(getFloorLabel(1)).toBe("1F");
		});

		test("returns 2F for position 2", () => {
			expect(getFloorLabel(2)).toBe("2F");
		});

		test("returns 100F for position 100", () => {
			expect(getFloorLabel(100)).toBe("100F");
		});
	});

	describe("formatFileSize", () => {
		test("formats bytes", () => {
			expect(formatFileSize(500)).toBe("500 B");
		});

		test("formats kilobytes", () => {
			expect(formatFileSize(2048)).toBe("2.0 KB");
		});

		test("formats megabytes", () => {
			expect(formatFileSize(1048576)).toBe("1.0 MB");
			expect(formatFileSize(2400000)).toBe("2.3 MB");
		});
	});
});

describe("UserCard", () => {
	describe("getRoleLabel", () => {
		test("maps Admin", () => {
			expect(getRoleLabel(UserRole.Admin)).toBe("Admin");
		});

		test("maps SuperMod", () => {
			expect(getRoleLabel(UserRole.SuperMod)).toBe("SuperMod");
		});

		test("maps Mod", () => {
			expect(getRoleLabel(UserRole.Mod)).toBe("Moderator");
		});

		test("maps User", () => {
			expect(getRoleLabel(UserRole.User)).toBe("Member");
		});
	});

	describe("formatDate", () => {
		test("returns empty string for 0", () => {
			expect(formatDate(0)).toBe("");
		});

		test("formats Unix timestamp to YYYY-MM-DD", () => {
			// 2024-01-15T00:00:00Z = 1705276800
			expect(formatDate(1705276800)).toBe("2024-01-15");
		});
	});
});
