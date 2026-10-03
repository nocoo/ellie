import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_URL, getAvatarUrl } from "@/lib/avatar";

describe("getAvatarUrl", () => {
	it("uses the bundled default immediately for an explicitly empty path", () => {
		expect(getAvatarUrl("")).toBe(FALLBACK_URL);
		expect(FALLBACK_URL).toBe("/default-avatar.gif");
		expect(existsSync(resolve(import.meta.dirname, "../../../public/default-avatar.gif"))).toBe(
			true,
		);
	});

	it.each(["avatars/abc123.jpg", "avatar/000/01/23/45_avatar_big.jpg"])(
		"uses the stored object key without guessing or proxying: %s",
		(path) => {
			expect(getAvatarUrl(path)).toBe(`https://t.no.mt/${path}`);
		},
	);

	it.each([null, undefined])("rejects incomplete payloads instead of probing (%s)", (path) => {
		expect(() => Reflect.apply(getAvatarUrl, null, [path])).toThrow("Avatar path is required");
	});
});
