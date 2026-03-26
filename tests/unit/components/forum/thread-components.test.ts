import { describe, expect, test } from "bun:test";
import { mapBadgeVariant } from "@/components/forum/thread-badge";
import { highlightToStyle } from "@/components/forum/thread-item";
import { SORT_OPTIONS } from "@/components/forum/thread-list";

describe("ThreadBadge", () => {
	describe("mapBadgeVariant", () => {
		test("maps destructive to destructive", () => {
			expect(mapBadgeVariant("destructive")).toBe("destructive");
		});

		test("maps warning to outline", () => {
			expect(mapBadgeVariant("warning")).toBe("outline");
		});

		test("maps success to default", () => {
			expect(mapBadgeVariant("success")).toBe("default");
		});

		test("maps secondary to secondary", () => {
			expect(mapBadgeVariant("secondary")).toBe("secondary");
		});

		test("maps default to outline", () => {
			expect(mapBadgeVariant("default")).toBe("outline");
		});
	});
});

describe("ThreadItem", () => {
	describe("highlightToStyle", () => {
		test("returns empty object for null", () => {
			expect(highlightToStyle(null)).toEqual({});
		});

		test("applies color", () => {
			const style = highlightToStyle({
				color: "#ff0000",
				bold: false,
				italic: false,
				underline: false,
			});
			expect(style.color).toBe("#ff0000");
		});

		test("applies bold", () => {
			const style = highlightToStyle({ color: null, bold: true, italic: false, underline: false });
			expect(style.fontWeight).toBe("bold");
		});

		test("applies italic", () => {
			const style = highlightToStyle({ color: null, bold: false, italic: true, underline: false });
			expect(style.fontStyle).toBe("italic");
		});

		test("applies underline", () => {
			const style = highlightToStyle({ color: null, bold: false, italic: false, underline: true });
			expect(style.textDecoration).toBe("underline");
		});

		test("applies all styles together", () => {
			const style = highlightToStyle({
				color: "#00ff00",
				bold: true,
				italic: true,
				underline: true,
			});
			expect(style.color).toBe("#00ff00");
			expect(style.fontWeight).toBe("bold");
			expect(style.fontStyle).toBe("italic");
			expect(style.textDecoration).toBe("underline");
		});

		test("omits unset properties", () => {
			const style = highlightToStyle({ color: null, bold: false, italic: false, underline: false });
			expect(Object.keys(style).length).toBe(0);
		});
	});
});

describe("ThreadList", () => {
	describe("SORT_OPTIONS", () => {
		test("has 3 options", () => {
			expect(SORT_OPTIONS.length).toBe(3);
		});

		test("includes latest, newest, hot", () => {
			const values = SORT_OPTIONS.map((o) => o.value);
			expect(values).toContain("latest");
			expect(values).toContain("newest");
			expect(values).toContain("hot");
		});

		test("each option has label", () => {
			for (const option of SORT_OPTIONS) {
				expect(option.label.length).toBeGreaterThan(0);
			}
		});
	});
});
