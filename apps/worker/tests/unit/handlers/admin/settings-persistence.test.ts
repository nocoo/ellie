import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bulkUpdate, list } from "../../../../src/handlers/admin/settings";
import { getSettings, type SettingsDetailMap } from "../../../../src/lib/settings";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

describe("admin settings persistence", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		f = readingFixture();
		const batch = f.env.DB.batch.bind(f.env.DB);
		vi.spyOn(f.env.DB, "batch").mockImplementation(async (statements) => {
			f.sqlite.exec("BEGIN");
			try {
				const result = await batch(statements);
				f.sqlite.exec("COMMIT");
				return result;
			} catch (error) {
				f.sqlite.exec("ROLLBACK");
				throw error;
			}
		});
	});

	afterEach(() => {
		f.close();
		vi.restoreAllMocks();
	});

	async function readAdmin() {
		const response = await list(createAdminRequest("GET", "/api/admin/settings"), f.env);
		expect(response.status).toBe(200);
		return ((await response.json()) as { data: SettingsDetailMap }).data;
	}

	it.each([
		["general.site.copyright_years", "2001–2026", "string", "2001–2026"],
		["general.site.home_label", "同济网", "string", "同济网"],
		[
			"general.site.logo_dark",
			"https://example.com/dark.png",
			"string",
			"https://example.com/dark.png",
		],
		[
			"general.site.footer_bg_dark",
			"https://example.com/bg.png",
			"string",
			"https://example.com/bg.png",
		],
		["general.search.enabled", "false", "boolean", false],
		["features.registration.allow_new_user", "false", "boolean", false],
		["features.posting.min_registration_days", "0", "number", 0],
		["general.pagination.posts_per_page", "30", "number", 30],
		[
			"general.navigation.header_links",
			'[{"label":"首页","url":"/"}]',
			"json",
			[{ label: "首页", url: "/" }],
		],
	])("creates missing %s and refreshes both warmed readers", async (key, value, type, parsed) => {
		f.sqlite.prepare("DELETE FROM settings WHERE key = ?").run(key);
		expect((await getSettings(f.env))[key]).toBeUndefined();
		expect((await readAdmin())[key]).toBeUndefined();

		const response = await bulkUpdate(
			createAdminRequest("PUT", "/api/admin/settings", { [key]: value }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect((await response.json()).data.updated).toBe(1);
		expect(f.sqlite.prepare("SELECT value, type FROM settings WHERE key = ?").get(key)).toEqual({
			value,
			type,
		});
		expect((await readAdmin())[key]).toMatchObject({ value, type });
		expect((await getSettings(f.env))[key]).toEqual(parsed);
		expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	});

	it("updates an existing row without replacing its ID", async () => {
		f.insert("settings", {
			id: 9876,
			key: "general.site.copyright_years",
			value: "2001-2013",
			type: "string",
		});
		const response = await bulkUpdate(
			createAdminRequest("PUT", "/api/admin/settings", {
				"general.site.copyright_years": "2001-2026",
			}),
			f.env,
		);
		expect(response.status).toBe(200);
		expect(
			f.sqlite
				.prepare("SELECT id, value FROM settings WHERE key = ?")
				.get("general.site.copyright_years"),
		).toEqual({ id: 9876, value: "2001-2026" });
	});

	it("refreshes warmed settings when saving the same value repairs its historical type", async () => {
		const key = "general.search.enabled";
		f.sqlite.prepare("UPDATE settings SET value = 'false', type = 'string' WHERE key = ?").run(key);
		expect((await getSettings(f.env))[key]).toBe("false");
		expect((await readAdmin())[key].type).toBe("string");

		const response = await bulkUpdate(
			createAdminRequest("PUT", "/api/admin/settings", { [key]: "false" }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect((await getSettings(f.env))[key]).toBe(false);
		expect((await readAdmin())[key]).toMatchObject({ value: "false", type: "boolean" });
	});

	it("rolls back a mixed insert/update batch when SQL fails and preserves the warmed cache", async () => {
		f.insert("settings", { key: "general.site.name", value: "Before", type: "string" });
		const before = await getSettings(f.env);
		await readAdmin();
		const cached = new Map(f.values);
		f.sqlite.exec(
			"CREATE TRIGGER reject_home_label BEFORE INSERT ON settings WHEN NEW.key = 'general.site.home_label' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
		);

		await expect(
			bulkUpdate(
				createAdminRequest("PUT", "/api/admin/settings", {
					"general.site.name": "After",
					"general.site.copyright_years": "2001-2026",
					"general.site.home_label": "New home",
				}),
				f.env,
			),
		).rejects.toThrow("injected failure");
		expect(
			f.sqlite.prepare("SELECT value FROM settings WHERE key = 'general.site.name'").get(),
		).toEqual({ value: "Before" });
		expect(
			f.sqlite
				.prepare(
					"SELECT key FROM settings WHERE key IN ('general.site.copyright_years', 'general.site.home_label')",
				)
				.all(),
		).toEqual([]);
		expect(f.values).toEqual(cached);
		expect(await getSettings(f.env)).toEqual(before);
		expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_logs").get()).toEqual({
			count: 0,
		});
	});

	it.each(["zero", "missing-meta", "incomplete", "failed"])(
		"rejects %s write confirmation without a success response or cache invalidation",
		async (kind) => {
			await getSettings(f.env);
			await readAdmin();
			const cached = new Map(f.values);
			const results =
				kind === "incomplete"
					? []
					: [
							{
								success: kind !== "failed",
								results: [],
								...(kind === "missing-meta" ? {} : { meta: { changes: kind === "zero" ? 0 : 1 } }),
							},
						];
			vi.mocked(f.env.DB.batch).mockResolvedValueOnce(results as D1Result[]);
			await expect(
				bulkUpdate(
					createAdminRequest("PUT", "/api/admin/settings", {
						"general.site.copyright_years": "2001-2026",
					}),
					f.env,
				),
			).rejects.toThrow(/confirm/i);
			expect(f.values).toEqual(cached);
			expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_logs").get()).toEqual({
				count: 0,
			});
		},
	);

	it.each([
		["general.site.copyright_years", null],
		["general.site.name", { nested: true }],
		["general.site.name", ["unexpected"]],
		["features.registration.allow_new_user", "yes"],
		["general.pagination.page_size", "Infinity"],
		["general.pagination.posts_per_page", "1.5"],
		["general.pagination.max_post_length", "9007199254740992"],
		["general.search.enabled", "1"],
		["unknown.setting", "anything"],
	])("rejects invalid %s before any writes", async (key, value) => {
		const response = await bulkUpdate(
			createAdminRequest("PUT", "/api/admin/settings", { [key]: value }),
			f.env,
		);
		expect(response.status).toBe(400);
		expect(f.env.DB.batch).not.toHaveBeenCalled();
		expect(f.env.KV.delete).not.toHaveBeenCalled();
	});
});
