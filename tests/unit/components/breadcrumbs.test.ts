import { describe, expect, test } from "bun:test";
import type { BreadcrumbItem } from "@/components/breadcrumbs";

// Breadcrumbs is a React component — full rendering tests are L2/L3.
// L1 tests validate the data contract and type exports.

describe("Breadcrumbs data contract", () => {
	test("BreadcrumbItem supports label-only (current page)", () => {
		const item: BreadcrumbItem = { label: "Current Page" };
		expect(item.label).toBe("Current Page");
		expect(item.href).toBeUndefined();
	});

	test("BreadcrumbItem supports label + href (linkable)", () => {
		const item: BreadcrumbItem = { label: "Forums", href: "/forums" };
		expect(item.label).toBe("Forums");
		expect(item.href).toBe("/forums");
	});

	test("Breadcrumbs component is exported", async () => {
		const mod = await import("@/components/breadcrumbs");
		expect(typeof mod.Breadcrumbs).toBe("function");
	});

	test("typical forum breadcrumb trail", () => {
		const trail: BreadcrumbItem[] = [
			{ label: "Forums", href: "/forums" },
			{ label: "Tech Talk", href: "/forums/10" },
			{ label: "Thread Title" },
		];
		expect(trail).toHaveLength(3);
		// Last item has no href (current page)
		expect(trail[trail.length - 1].href).toBeUndefined();
		// Middle items have hrefs
		expect(trail[0].href).toBeDefined();
		expect(trail[1].href).toBeDefined();
	});

	test("empty breadcrumb trail is valid", () => {
		const trail: BreadcrumbItem[] = [];
		expect(trail).toHaveLength(0);
	});
});
