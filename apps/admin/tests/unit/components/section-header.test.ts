// SectionHeader — type contract + className token guards.
//
// Same convention as segmented-switch.test.ts: no DOM render, just lock
// the props surface and the visual tokens that matter.
//
// Tokens we pin reflect the pew DashboardSegment look this component
// borrows: a small uppercase muted h2 + a hairline divider that fills
// the row. If a future refactor accidentally drops the divider or
// promotes the title to a heavyweight header, this test breaks first.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SectionHeaderProps } from "../../../src/components/admin/section-header";

describe("SectionHeader types", () => {
	it("accepts a minimal title-only prop set", () => {
		const props: SectionHeaderProps = { title: "视图" };
		expect(props.title).toBe("视图");
		expect(props.action).toBeUndefined();
		expect(props.description).toBeUndefined();
	});

	it("accepts description + action slots", () => {
		const props: SectionHeaderProps = {
			title: "视图",
			description: "Description text",
			action: null,
		};
		expect(props.description).toBe("Description text");
	});
});

const SOURCE = readFileSync(
	fileURLToPath(new URL("../../../src/components/admin/section-header.tsx", import.meta.url)),
	"utf8",
);

describe("SectionHeader — pinned class tokens", () => {
	it("title uses small uppercase muted label (matches pew DashboardSegment)", () => {
		expect(SOURCE).toContain("text-xs");
		expect(SOURCE).toContain("font-medium");
		expect(SOURCE).toContain("uppercase");
		expect(SOURCE).toContain("tracking-wider");
		expect(SOURCE).toContain("text-muted-foreground");
	});

	it("renders a hairline divider that fills the row (h-px flex-1 bg-border/60)", () => {
		expect(SOURCE).toContain("h-px");
		expect(SOURCE).toContain("flex-1");
		expect(SOURCE).toContain("bg-border/60");
	});

	it("uses semantic h2 + header element for accessibility", () => {
		expect(SOURCE).toContain("<h2");
		expect(SOURCE).toContain("<header");
	});

	it("action slot is right-aligned and does not shrink", () => {
		expect(SOURCE).toContain("shrink-0");
	});
});
