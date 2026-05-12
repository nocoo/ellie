// Pin the wide-dialog preset class tokens so a future refactor can't
// silently shrink the KV / log / reports detail dialogs back to a
// narrow `sm:max-w-lg` look.
//
// Convention matches `section-header.test.ts` / `segmented-switch.test.ts`:
// no DOM render — just lock the visual contract.

import { describe, expect, it } from "vitest";
import {
	ADMIN_WIDE_DIALOG_BODY_CLASS,
	ADMIN_WIDE_DIALOG_CONTENT_CLASS,
} from "../../../src/components/admin/dialog-presets";

describe("ADMIN_WIDE_DIALOG_CONTENT_CLASS", () => {
	it("fills the viewport on small screens (with gutter)", () => {
		expect(ADMIN_WIDE_DIALOG_CONTENT_CLASS).toContain("w-[calc(100vw-2rem)]");
	});

	it("caps at max-w-5xl on wide screens (visible from @zheng-li feedback msg=eea0731e)", () => {
		expect(ADMIN_WIDE_DIALOG_CONTENT_CLASS).toContain("max-w-5xl");
	});

	it("uses overflow-hidden so the dialog itself never scrolls horizontally", () => {
		expect(ADMIN_WIDE_DIALOG_CONTENT_CLASS).toContain("overflow-hidden");
	});
});

describe("ADMIN_WIDE_DIALOG_BODY_CLASS", () => {
	it("uses min-w-0 so flex/grid children can shrink", () => {
		expect(ADMIN_WIDE_DIALOG_BODY_CLASS).toContain("min-w-0");
	});

	it("caps body height to 80vh so dialog stays in viewport", () => {
		expect(ADMIN_WIDE_DIALOG_BODY_CLASS).toContain("max-h-[80vh]");
	});

	it("scrolls the body vertically when content is long", () => {
		expect(ADMIN_WIDE_DIALOG_BODY_CLASS).toContain("overflow-y-auto");
	});
});
