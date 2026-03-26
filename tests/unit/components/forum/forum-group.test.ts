import { describe, expect, test } from "bun:test";

describe("ForumGroup", () => {
	test("ForumGroup component is exported", async () => {
		const mod = await import("@/components/forum/forum-group");
		expect(mod.ForumGroup).toBeDefined();
	});
});
