import { describe, expect, test } from "vitest";
import { computeAvatarPath, computeAvatarR2Key, getAvatarValue } from "../src/transform/avatar";

describe("computeAvatarPath", () => {
	test("uid=1", () => {
		// 1 % 16 = 1 → "01", 1 % 256 = 1 → "01"
		expect(computeAvatarPath(1)).toBe("data/avatar/01/01/1_avatar_big.jpg");
	});

	test("uid=16", () => {
		// 16 % 16 = 0 → "00", 16 % 256 = 16 → "10"
		expect(computeAvatarPath(16)).toBe("data/avatar/00/10/16_avatar_big.jpg");
	});

	test("uid=256", () => {
		// 256 % 16 = 0 → "00", 256 % 256 = 0 → "00"
		expect(computeAvatarPath(256)).toBe("data/avatar/00/00/256_avatar_big.jpg");
	});

	test("uid=1000", () => {
		// 1000 % 16 = 8 → "08", 1000 % 256 = 232 → "e8"
		expect(computeAvatarPath(1000)).toBe("data/avatar/08/e8/1000_avatar_big.jpg");
	});

	test("uid=255", () => {
		// 255 % 16 = 15 → "0f", 255 % 256 = 255 → "ff"
		expect(computeAvatarPath(255)).toBe("data/avatar/0f/ff/255_avatar_big.jpg");
	});

	test("uid=70000 (large uid)", () => {
		// 70000 % 16 = 0 → "00", 70000 % 256 = 112 → "70"
		expect(computeAvatarPath(70000)).toBe("data/avatar/00/70/70000_avatar_big.jpg");
	});
});

describe("computeAvatarR2Key", () => {
	test("generates R2 key", () => {
		expect(computeAvatarR2Key(1)).toBe("avatars/1.jpg");
	});

	test("large uid", () => {
		expect(computeAvatarR2Key(123456)).toBe("avatars/123456.jpg");
	});
});

describe("getAvatarValue", () => {
	test("avatarstatus=0 returns empty string", () => {
		expect(getAvatarValue(1, 0)).toBe("");
	});

	test("avatarstatus=1 returns R2 key", () => {
		expect(getAvatarValue(1, 1)).toBe("avatars/1.jpg");
	});

	test("avatarstatus=2 (unexpected value) returns empty string", () => {
		expect(getAvatarValue(1, 2)).toBe("");
	});
});
