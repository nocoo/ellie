// User-edit dialog — IPv6 layout regression guard.
//
// The dialog used to render `regIp` / `lastIp` in a fixed two-column grid
// inside a 520px container, causing IPv6 (~39 chars) to overflow the
// half-column. The rewrite moves IPs to a single column and forces the
// `<Input>` to wrap with `break-all` + `min-w-0`. This test pins those
// className tokens so a future Tailwind cleanup can't silently regress
// the wrap behaviour and re-introduce the overlap.

import { describe, expect, it } from "vitest";
import { IP_INPUT_CLASSNAME } from "@/components/admin/user-edit-dialog";

describe("UserEditDialog — IP input className", () => {
	it("includes break-all so IPv6 wraps inside narrow viewports", () => {
		expect(IP_INPUT_CLASSNAME).toContain("break-all");
	});

	it("includes min-w-0 so the flex/grid parent can shrink the input", () => {
		expect(IP_INPUT_CLASSNAME).toContain("min-w-0");
	});

	it("uses w-full (single-column layout) instead of grid-cols-2 fixed half", () => {
		expect(IP_INPUT_CLASSNAME).toContain("w-full");
	});

	it("uses font-mono so IP groups stay aligned", () => {
		expect(IP_INPUT_CLASSNAME).toContain("font-mono");
	});
});
