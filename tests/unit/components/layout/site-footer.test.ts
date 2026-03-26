import { describe, expect, test } from "bun:test";
import { FOOTER_LINKS, getCopyrightYear } from "@/components/layout/site-footer";

describe("SiteFooter", () => {
	describe("FOOTER_LINKS", () => {
		test("exports non-empty links array", () => {
			expect(FOOTER_LINKS.length).toBeGreaterThan(0);
		});

		test("each link has href and label", () => {
			for (const link of FOOTER_LINKS) {
				expect(typeof link.href).toBe("string");
				expect(link.href.startsWith("/")).toBe(true);
				expect(typeof link.label).toBe("string");
				expect(link.label.length).toBeGreaterThan(0);
			}
		});

		test("includes About, Terms, Privacy", () => {
			const labels = FOOTER_LINKS.map((l) => l.label);
			expect(labels).toContain("About");
			expect(labels).toContain("Terms");
			expect(labels).toContain("Privacy");
		});

		test("no duplicate hrefs", () => {
			const hrefs = FOOTER_LINKS.map((l) => l.href);
			expect(new Set(hrefs).size).toBe(hrefs.length);
		});
	});

	describe("getCopyrightYear", () => {
		test("returns string starting with 2006-", () => {
			const year = getCopyrightYear();
			expect(year.startsWith("2006-")).toBe(true);
		});

		test("ends with current year", () => {
			const year = getCopyrightYear();
			const current = new Date().getFullYear();
			expect(year).toBe(`2006-${current}`);
		});
	});
});
