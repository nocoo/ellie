import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	SETTING_GROUPS,
	type SettingsDetailMap,
	type SettingsUpdatePayload,
	getChangedSettings,
	toFormValues,
	updateSettings,
} from "../../../../apps/web/src/viewmodels/admin/settings";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	mockFetchFn = mock(() =>
		Promise.resolve(
			mockJsonResponse({
				data: { updated: 3 },
				meta: { timestamp: 1711612800000, requestId: "r1" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// SETTING_GROUPS structure tests
// ---------------------------------------------------------------------------

describe("SETTING_GROUPS", () => {
	it("should have exactly 3 groups", () => {
		expect(SETTING_GROUPS).toHaveLength(3);
	});

	it("should define 14 total fields across all groups", () => {
		const totalFields = SETTING_GROUPS.reduce((sum, g) => sum + g.fields.length, 0);
		expect(totalFields).toBe(14);
	});

	it("should have correct group titles", () => {
		const titles = SETTING_GROUPS.map((g) => g.title);
		expect(titles).toEqual(["站点品牌", "OG 社交媒体元数据", "分页与限制"]);
	});

	it("should have correct group prefixes", () => {
		const prefixes = SETTING_GROUPS.map((g) => g.prefix);
		expect(prefixes).toEqual(["general.site", "general.og", "general.pagination"]);
	});

	it("all fields should have keys matching their group prefix", () => {
		for (const group of SETTING_GROUPS) {
			for (const field of group.fields) {
				expect(field.key.startsWith(group.prefix)).toBe(true);
			}
		}
	});

	it("all pagination fields should have inputType 'number'", () => {
		const paginationGroup = SETTING_GROUPS.find((g) => g.prefix === "general.pagination");
		expect(paginationGroup).toBeDefined();
		for (const field of paginationGroup?.fields ?? []) {
			expect(field.inputType).toBe("number");
		}
	});

	it("URL fields should have inputType 'url'", () => {
		const urlFields = SETTING_GROUPS.flatMap((g) => g.fields).filter((f) => f.inputType === "url");
		expect(urlFields.length).toBeGreaterThan(0);
		for (const field of urlFields) {
			expect(field.key).toMatch(/\.(image|url)$/);
		}
	});

	it("should have unique keys across all groups", () => {
		const allKeys = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
		const uniqueKeys = new Set(allKeys);
		expect(allKeys.length).toBe(uniqueKeys.size);
	});

	it("all fields should have labels", () => {
		for (const group of SETTING_GROUPS) {
			for (const field of group.fields) {
				expect(field.label).toBeTruthy();
			}
		}
	});

	it("all groups should have descriptions", () => {
		for (const group of SETTING_GROUPS) {
			expect(group.description).toBeTruthy();
		}
	});
});

// ---------------------------------------------------------------------------
// toFormValues
// ---------------------------------------------------------------------------

describe("toFormValues", () => {
	it("should convert SettingsDetailMap to flat string map", () => {
		const settings: SettingsDetailMap = {
			"general.site.name": { value: "Ellie", type: "string", updatedAt: 1700000000 },
			"general.pagination.posts_per_page": { value: "20", type: "number", updatedAt: 1700000000 },
		};

		const result = toFormValues(settings);

		expect(result).toEqual({
			"general.site.name": "Ellie",
			"general.pagination.posts_per_page": "20",
		});
	});

	it("should handle empty settings", () => {
		expect(toFormValues({})).toEqual({});
	});

	it("should preserve empty string values", () => {
		const settings: SettingsDetailMap = {
			"general.og.title": { value: "", type: "string", updatedAt: 1700000000 },
		};

		const result = toFormValues(settings);

		expect(result["general.og.title"]).toBe("");
	});

	it("should handle multiple entries", () => {
		const settings: SettingsDetailMap = {
			"general.site.name": { value: "Ellie", type: "string", updatedAt: 1700000000 },
			"general.site.subtitle": { value: "Test", type: "string", updatedAt: 1700000000 },
			"general.og.title": { value: "OG Title", type: "string", updatedAt: 1700000000 },
		};

		const result = toFormValues(settings);
		expect(Object.keys(result)).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// getChangedSettings
// ---------------------------------------------------------------------------

describe("getChangedSettings", () => {
	it("should return only changed values", () => {
		const current = { a: "new", b: "same", c: "changed" };
		const saved = { a: "old", b: "same", c: "original" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ a: "new", c: "changed" });
	});

	it("should return empty object when nothing changed", () => {
		const values = { a: "1", b: "2" };

		expect(getChangedSettings(values, values)).toEqual({});
	});

	it("should detect empty string as change from non-empty", () => {
		const current = { "general.site.name": "" };
		const saved = { "general.site.name": "Ellie" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ "general.site.name": "" });
	});

	it("should handle new keys in current (not in saved)", () => {
		const current = { a: "1", b: "new" };
		const saved = { a: "1" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ b: "new" });
	});

	it("should not include keys that exist in saved but not current", () => {
		const current = { a: "1" };
		const saved = { a: "1", b: "2" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({});
	});

	it("should handle both current and saved being empty", () => {
		expect(getChangedSettings({}, {})).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe("updateSettings", () => {
	it("calls PUT /api/admin/settings with payload", async () => {
		const payload: SettingsUpdatePayload = {
			"general.site.name": "New Name",
			"general.site.subtitle": "New Subtitle",
		};

		const result = await updateSettings(payload);
		expect(result.updated).toBe(3);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/settings");
		expect(opts.method).toBe("PUT");
		expect(JSON.parse(opts.body as string)).toEqual(payload);
	});
});
