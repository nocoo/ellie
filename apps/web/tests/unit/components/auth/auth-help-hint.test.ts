import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @vitest-environment happy-dom
// Tests for AuthHelpHint — contact-admin row gated on CAPTCHA success.
//
// The hint must:
//   1. Render nothing when `visible === false` (default / pre-CAPTCHA state)
//   2. Render the contact text + mailto link when `visible === true`
//   3. Never leak the literal full email into the module source —
//      it must be assembled at runtime so a static HTML scrape misses it.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthHelpHint } from "../../../../src/app/(auth)/_components/auth-id-card";

afterEach(() => {
	cleanup();
});

// Build the expected email at runtime so this test file itself never
// stores the full literal (would defeat the anti-scrape guarantee for
// anyone grepping the test corpus too).
const EXPECTED_EMAIL = String.fromCharCode(
	104,
	101,
	108,
	112,
	64,
	116,
	111,
	110,
	103,
	106,
	105,
	46,
	110,
	101,
	116,
);

describe("AuthHelpHint", () => {
	it("renders nothing when visible=false", () => {
		const { container } = render(createElement(AuthHelpHint, { visible: false }));
		expect(container.querySelector('[data-testid="auth-help-hint"]')).toBeNull();
		expect(container.textContent).toBe("");
	});

	it("renders contact-admin row when visible=true (after mount effect)", async () => {
		render(createElement(AuthHelpHint, { visible: true }));
		// Email is assembled in a useEffect → wait for the mount cycle.
		const hint = await waitFor(() => screen.getByTestId("auth-help-hint"));
		expect(hint).toBeTruthy();
		expect(hint.textContent).toContain("如遇问题，请发邮件到");
		expect(hint.textContent).toContain(EXPECTED_EMAIL);
	});

	it("renders a mailto link with the assembled address", async () => {
		render(createElement(AuthHelpHint, { visible: true }));
		const hint = await waitFor(() => screen.getByTestId("auth-help-hint"));
		const link = hint.querySelector("a");
		expect(link).toBeTruthy();
		expect(link?.getAttribute("href")).toBe(`mailto:${EXPECTED_EMAIL}`);
		expect(link?.textContent).toBe(EXPECTED_EMAIL);
	});

	it("does not contain the literal full email address in the source file (anti-scrape)", () => {
		// The address must be assembled at runtime from char codes so
		// static source/bundle scrapes miss it. Even SWC constant-folding
		// has nothing to fold because the codes live in a Uint8Array, not
		// in static string concatenations.
		const sourcePath = resolve(
			__dirname,
			"../../../../src/app/(auth)/_components/auth-id-card.tsx",
		);
		const source = readFileSync(sourcePath, "utf8");
		expect(source).not.toContain(EXPECTED_EMAIL);
		// And no naive string concatenations of the user/domain either.
		expect(source).not.toContain('"help"');
		expect(source).not.toContain('"tongji.net"');
		expect(source).not.toContain("'help'");
		expect(source).not.toContain("'tongji.net'");
	});
});
