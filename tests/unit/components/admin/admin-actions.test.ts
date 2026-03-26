import { describe, expect, test } from "bun:test";

describe("Admin action components", () => {
	test("AdminUserActions module exports correctly", async () => {
		const mod = await import("@/components/admin/admin-user-actions");
		expect(typeof mod.AdminUserActions).toBe("function");
	});

	test("AdminContentActions module exports correctly", async () => {
		const mod = await import("@/components/admin/admin-content-actions");
		expect(typeof mod.AdminContentActions).toBe("function");
	});

	test("AdminForumActions module exports correctly", async () => {
		const mod = await import("@/components/admin/admin-forum-actions");
		expect(typeof mod.AdminForumActions).toBe("function");
	});
});
