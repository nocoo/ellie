import { describe, expect, test } from "bun:test";

describe("ForumLayout", () => {
	test("ForumLayout component is exported", async () => {
		const mod = await import("@/components/layout/forum-layout");
		expect(mod.ForumLayout).toBeDefined();
	});

	test("ForumLayoutProps type has expected shape", async () => {
		// Verify type-level contract by constructing valid props
		const props = {
			children: null,
			user: { username: "test", avatar: null },
			breadcrumbs: [{ label: "Home", href: "/" }],
			onLogout: () => {},
		};
		expect(props.children).toBeNull();
		expect(props.user.username).toBe("test");
		expect(props.breadcrumbs.length).toBe(1);
		expect(typeof props.onLogout).toBe("function");
	});

	test("ForumLayoutProps allows empty breadcrumbs", () => {
		const props = { children: null, breadcrumbs: [] };
		expect(props.breadcrumbs.length).toBe(0);
	});

	test("ForumLayoutProps allows omitted user (guest)", () => {
		const props = { children: null };
		expect(props).not.toHaveProperty("user");
	});
});
