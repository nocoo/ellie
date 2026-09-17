import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThreadTypes } from "../../../src/handlers/forum";
import { __resetMetricsForTest } from "../../../src/lib/cache/metrics";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("getThreadTypes handler", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_700_000_000_000);
		__resetMetricsForTest();
		f = readingFixture();
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("returns 400 for invalid forum ID", async () => {
		const req = new Request("https://api.example.com/api/v1/forums/abc/thread-types");
		const res = await getThreadTypes(req, f.env, f.ctx);
		expect(res.status).toBe(400);
	});

	it("returns 404 when forum is missing or inactive", async () => {
		const reqMissing = new Request("https://api.example.com/api/v1/forums/999/thread-types");
		const resMissing = await getThreadTypes(reqMissing, f.env, f.ctx);
		expect(resMissing.status).toBe(404);

		// forum 3 in fixture has status = 0 (paused/inactive)
		const reqInactive = new Request("https://api.example.com/api/v1/forums/3/thread-types");
		const resInactive = await getThreadTypes(reqInactive, f.env, f.ctx);
		expect(resInactive.status).toBe(404);
	});

	it("returns 403 when viewer lacks forum visibility", async () => {
		// forum 2 is staff-only
		const anonReq = new Request("https://api.example.com/api/v1/forums/2/thread-types");
		const anonRes = await getThreadTypes(anonReq, f.env, f.ctx);
		expect(anonRes.status).toBe(403);

		// Regular user (role=0) also 403
		const token = await createJwtForRole(0, 10, f.env.JWT_SECRET);
		const userReq = new Request("https://api.example.com/api/v1/forums/2/thread-types", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const userRes = await getThreadTypes(userReq, f.env, f.ctx);
		expect(userRes.status).toBe(403);
	});

	it("returns config flags and enabled thread types on 200", async () => {
		f.sqlite
			.prepare(
				"UPDATE forums SET thread_types_enabled = 1, thread_types_required = 1, thread_types_listable = 1, thread_types_prefix = 1 WHERE id = 1",
			)
			.run();
		f.sqlite
			.prepare(
				"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, enabled, moderator_only) VALUES (1, 1, 10, 'Notice', 2, 1, 0), (2, 1, 20, 'Discussion', 1, 1, 0), (3, 1, 30, 'Archived', 0, 0, 0)",
			)
			.run();

		const req = new Request("https://api.example.com/api/v1/forums/1/thread-types");
		const res = await getThreadTypes(req, f.env, f.ctx);
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			data: {
				enabled: boolean;
				required: boolean;
				listable: boolean;
				prefix: boolean;
				types: {
					id: number;
					name: string;
					displayOrder: number;
					enabled: boolean;
					moderatorOnly: boolean;
				}[];
			};
		};

		expect(body.data.enabled).toBe(true);
		expect(body.data.required).toBe(true);
		expect(body.data.listable).toBe(true);
		expect(body.data.prefix).toBe(true);
		// Only enabled rows (Archived enabled=0 excluded)
		expect(body.data.types).toHaveLength(2);
		expect(body.data.types[0].name).toBe("Discussion");
		expect(body.data.types[1].name).toBe("Notice");
	});

	it("serves subsequent requests from cache without re-querying forum_thread_types", async () => {
		f.sqlite.prepare("UPDATE forums SET thread_types_enabled = 1 WHERE id = 1").run();
		f.sqlite
			.prepare(
				"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, enabled, moderator_only) VALUES (10, 1, 10, 'General', 1, 1, 0)",
			)
			.run();

		const req = new Request("https://api.example.com/api/v1/forums/1/thread-types");
		const res1 = await getThreadTypes(req, f.env, f.ctx);
		expect(res1.status).toBe(200);

		const callsBefore = f.calls.filter((c) => c.sql.includes("FROM forum_thread_types")).length;
		expect(callsBefore).toBe(1);

		// Cache hit
		const res2 = await getThreadTypes(req, f.env, f.ctx);
		expect(res2.status).toBe(200);

		const callsAfter = f.calls.filter((c) => c.sql.includes("FROM forum_thread_types")).length;
		expect(callsAfter).toBe(callsBefore);
	});
});
