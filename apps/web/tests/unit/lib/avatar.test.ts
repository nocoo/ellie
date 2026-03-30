import { describe, expect, test } from "bun:test";
import { getAvatarUrl } from "../../../src/lib/avatar";

describe("getAvatarUrl", () => {
	test("UID 12345 produces correct Discuz path segments", () => {
		expect(getAvatarUrl(12345, "big")).toBe("https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg");
	});

	test("UID 1 zero-pads to 9 digits", () => {
		expect(getAvatarUrl(1, "big")).toBe("https://t.no.mt/avatar/000/00/00/01_avatar_big.jpg");
	});

	test("UID 123456789 fills all segments", () => {
		expect(getAvatarUrl(123456789, "middle")).toBe(
			"https://t.no.mt/avatar/123/45/67/89_avatar_middle.jpg",
		);
	});

	test("UID > 9 digits does not crash", () => {
		const url = getAvatarUrl(1234567890, "small");
		// 10-digit UID: padStart(9) is no-op → "1234567890", slice(7,9) = "89"
		expect(url).toBe("https://t.no.mt/avatar/123/45/67/89_avatar_small.jpg");
	});

	test("default size is 'big'", () => {
		expect(getAvatarUrl(12345)).toBe("https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg");
	});

	test("small size produces correct suffix", () => {
		expect(getAvatarUrl(42, "small")).toBe("https://t.no.mt/avatar/000/00/00/42_avatar_small.jpg");
	});

	test("middle size produces correct suffix", () => {
		expect(getAvatarUrl(42, "middle")).toBe(
			"https://t.no.mt/avatar/000/00/00/42_avatar_middle.jpg",
		);
	});
});
