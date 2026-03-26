import { describe, expect, test } from "bun:test";

// TopBar exports
import type { TopBarUser } from "@/components/layout/topbar";

describe("TopBar", () => {
	test("TopBarUser type allows username and optional avatar", () => {
		const user: TopBarUser = { username: "test" };
		expect(user.username).toBe("test");
		expect(user.avatar).toBeUndefined();
	});

	test("TopBarUser allows null avatar", () => {
		const user: TopBarUser = { username: "test", avatar: null };
		expect(user.avatar).toBeNull();
	});

	test("TopBarUser allows string avatar", () => {
		const user: TopBarUser = { username: "test", avatar: "/path/to/avatar.jpg" };
		expect(user.avatar).toBe("/path/to/avatar.jpg");
	});

	test("TopBar component is exported", async () => {
		const mod = await import("@/components/layout/topbar");
		expect(mod.TopBar).toBeDefined();
	});
});
