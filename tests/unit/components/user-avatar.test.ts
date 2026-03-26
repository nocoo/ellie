import { describe, expect, test } from "bun:test";
import { getInitials } from "@/components/user-avatar";

describe("UserAvatar", () => {
	describe("getInitials", () => {
		test("returns first 2 chars uppercased for normal username", () => {
			expect(getInitials("admin")).toBe("AD");
		});

		test("returns first 2 chars uppercased for Chinese username", () => {
			expect(getInitials("张三")).toBe("张三");
		});

		test("handles single-character username", () => {
			expect(getInitials("a")).toBe("A");
		});

		test("handles short username (2 chars)", () => {
			expect(getInitials("ab")).toBe("AB");
		});

		test("uppercases mixed case", () => {
			expect(getInitials("zhangSan")).toBe("ZH");
		});
	});

	describe("component exports", () => {
		test("exports UserAvatar function", async () => {
			const mod = await import("@/components/user-avatar");
			expect(typeof mod.UserAvatar).toBe("function");
		});

		test("exports getInitials function", async () => {
			const mod = await import("@/components/user-avatar");
			expect(typeof mod.getInitials).toBe("function");
		});
	});
});
