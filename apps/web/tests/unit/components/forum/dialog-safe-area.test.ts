import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("safe-area dialog limits", () => {
	it.each([
		"components/forum/editor-dialog-shell.tsx",
		"components/forum/announcement-edit-dialog.tsx",
		"components/forum/profile-edit-dialog.tsx",
		"app/(auth)/login/login-form.tsx",
	])("%s preserves the safe-area cap when overriding dialog height", (path) => {
		const source = readFileSync(new URL(`../../../../src/${path}`, import.meta.url), "utf8");
		const cap = "max-h-[min(90dvh,var(--dialog-max-height))]";
		expect(source).toContain(cap);
		expect(source).not.toContain("max-h-[90dvh]");
		expect(cn("max-h-(--dialog-max-height)", cap)).toBe(cap);
	});
});
