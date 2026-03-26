import { describe, expect, test } from "bun:test";
import { SMILEY_MAP, SMILEY_PACKS, getSmileyPath, getSmileysByPack } from "@/lib/smiley-map";

describe("smiley-map", () => {
	describe("SMILEY_MAP", () => {
		test("contains common smiley codes", () => {
			expect(SMILEY_MAP[":)"]).toBe("/smileys/default/smile.gif");
			expect(SMILEY_MAP[":("]).toBe("/smileys/default/sad.gif");
			expect(SMILEY_MAP[":D"]).toBe("/smileys/default/biggrin.gif");
		});

		test("contains soso pack entries", () => {
			expect(SMILEY_MAP["{:soso_e113:}"]).toBe("/smileys/soso/e113.gif");
		});

		test("contains coolmonkey pack entries", () => {
			expect(SMILEY_MAP["{:coolmonkey_001:}"]).toBe("/smileys/coolmonkey/001.gif");
		});

		test("all paths start with /smileys/", () => {
			for (const path of Object.values(SMILEY_MAP)) {
				expect(path.startsWith("/smileys/")).toBe(true);
			}
		});

		test("all paths end with valid image extension", () => {
			const validExtensions = [".gif", ".png", ".jpg", ".jpeg"];
			for (const path of Object.values(SMILEY_MAP)) {
				const hasValidExt = validExtensions.some((ext) => path.endsWith(ext));
				expect(hasValidExt).toBe(true);
			}
		});
	});

	describe("SMILEY_PACKS", () => {
		test("includes expected packs", () => {
			expect(SMILEY_PACKS).toContain("default");
			expect(SMILEY_PACKS).toContain("coolmonkey");
			expect(SMILEY_PACKS).toContain("soso");
		});
	});

	describe("getSmileyPath", () => {
		test("returns path for known code", () => {
			expect(getSmileyPath(":)")).toBe("/smileys/default/smile.gif");
		});

		test("returns null for unknown code", () => {
			expect(getSmileyPath(":unknown:")).toBeNull();
		});

		test("returns null for empty string", () => {
			expect(getSmileyPath("")).toBeNull();
		});
	});

	describe("getSmileysByPack", () => {
		test("returns smileys from default pack", () => {
			const defaults = getSmileysByPack("default");
			expect(defaults.length).toBeGreaterThan(0);
			for (const entry of defaults) {
				expect(entry.path.startsWith("/smileys/default/")).toBe(true);
			}
		});

		test("returns smileys from soso pack", () => {
			const soso = getSmileysByPack("soso");
			expect(soso.length).toBeGreaterThan(0);
			for (const entry of soso) {
				expect(entry.path.startsWith("/smileys/soso/")).toBe(true);
			}
		});

		test("returns smileys from coolmonkey pack", () => {
			const coolmonkey = getSmileysByPack("coolmonkey");
			expect(coolmonkey.length).toBeGreaterThan(0);
			for (const entry of coolmonkey) {
				expect(entry.path.startsWith("/smileys/coolmonkey/")).toBe(true);
			}
		});

		test("each entry has code and path", () => {
			const entries = getSmileysByPack("default");
			for (const entry of entries) {
				expect(typeof entry.code).toBe("string");
				expect(typeof entry.path).toBe("string");
				expect(entry.code.length).toBeGreaterThan(0);
			}
		});
	});
});
