// tests/integration/http/kv-monitor.test.ts — L2 Worker KV monitor admin
// Covers the routes added in the kv-monitor track (commits A → C):
//   GET  /api/admin/kv/overview
//   GET  /api/admin/kv/list
//   GET  /api/admin/kv/get
//   POST /api/admin/kv/refresh
//   GET  /api/admin/kv/metrics
//
// Goals:
//   - Hit each route at least once with Key B (admin) so the L2 strict
//     coverage audit registers them as covered.
//   - Exercise the typed `KvRefreshAction` happy path against a no-arg
//     bump (`forum:summary:v2` → `bump-forum-summary`) — safe to run in
//     the test environment because it only writes to the gen key and
//     records a `bump` metric; no business data is mutated.
//   - Assert sensitivity guards (`KV_KEY_NAME_HIDDEN`,
//     `KV_ACTION_MISMATCH`) since they are the contract the admin UI
//     relies on.
//
// Notes:
//   - The Worker is started by scripts/run-l2.ts; this test only issues
//     HTTP. KV registry is data-only so its membership is stable.
//   - Success responses use the standard `{ data, meta }` envelope from
//     `lib/response.ts:jsonResponse`. Errors are flat
//     `{ error: { code, ... } }` from `middleware/error.ts:errorResponse`.

import { describe, expect, test } from "bun:test";
import { adminGet, adminPost, workerFetch } from "../setup";

describe("L2: Worker Admin KV Monitor", () => {
	test("inspects, rebuilds and deletes one real snapshot with an audit trail", async () => {
		const warm = await workerFetch("/api/v1/settings");
		expect(warm.status).toBe(200);
		await warm.json();

		const beforeResponse = await adminGet("/api/admin/kv/inspect?key=settings%3Aall");
		expect(beforeResponse.status).toBe(200);
		expect(beforeResponse.headers.get("Cache-Control")).toContain("no-store");
		const before = (await beforeResponse.json()) as {
			data: { status: string; tier: string; loadedAt: number; expiresAt: number; value: unknown };
		};
		expect(before.data.status).toBe("valid");
		expect(before.data.tier).toBe("LONG");
		expect(before.data.expiresAt - before.data.loadedAt).toBe(86_400_000);

		const again = await adminGet("/api/admin/kv/inspect?key=settings%3Aall");
		const inspectedAgain = (await again.json()) as {
			data: { loadedAt: number; expiresAt: number };
		};
		expect(inspectedAgain.data.loadedAt).toBe(before.data.loadedAt);
		expect(inspectedAgain.data.expiresAt).toBe(before.data.expiresAt);

		const rebuild = await adminPost("/api/admin/kv/rebuild", {
			family: "settings:all",
			key: "settings:all",
		});
		expect(rebuild.status).toBe(200);
		const rebuilt = (await rebuild.json()) as {
			data: {
				outcome: string;
				stage: string;
				tier: string;
				loadedAt: number;
				expiresAt: number;
				value: unknown;
				consistencyNote: string;
			};
		};
		expect(rebuilt.data.outcome).toBe("rebuilt");
		expect(rebuilt.data.stage).toBe("complete");
		expect(rebuilt.data.tier).toBe("LONG");
		expect(rebuilt.data.expiresAt - rebuilt.data.loadedAt).toBe(86_400_000);
		expect(rebuilt.data.value).toEqual(before.data.value);
		expect(rebuilt.data.consistencyNote).toBe("written-not-globally-visible");

		const deletion = await adminPost("/api/admin/kv/delete", {
			family: "settings:all",
			key: "settings:all",
		});
		expect(deletion.status).toBe(200);
		const deleted = (await deletion.json()) as { data: { outcome: string; deletedKeys: string[] } };
		expect(deleted.data.outcome).toBe("deleted");
		expect(deleted.data.deletedKeys).toEqual(["settings:all"]);
		const missing = await adminGet("/api/admin/kv/inspect?key=settings%3Aall");
		expect(((await missing.json()) as { data: { status: string } }).data.status).toBe("not-found");

		const audit = await adminGet("/api/admin/kv/operations?limit=10");
		expect(audit.status).toBe(200);
		const operations = (await audit.json()) as {
			data: { rows: { action: string; details: string }[] };
		};
		expect(operations.data.rows.map((row) => row.action)).toContain("kv.rebuild");
		expect(operations.data.rows.map((row) => row.action)).toContain("kv.delete_key");
		for (const row of operations.data.rows)
			expect(JSON.parse(row.details)).not.toHaveProperty("value");
		// Normal traffic may refill after deletion; underlying settings still exist.
		expect((await workerFetch("/api/v1/settings")).status).toBe(200);
	});

	test("new management routes keep runtime state and API-key boundaries", async () => {
		expect((await adminGet("/api/admin/kv/inspect?key=refresh%3Afake-token")).status).toBe(403);
		const deletion = await adminPost("/api/admin/kv/delete", {
			family: "gen:thread:list:all",
			key: "thread:list:gen:all",
		});
		expect(((await deletion.json()) as { data: { outcome: string } }).data.outcome).toBe(
			"not-allowed",
		);
		expect([401, 403]).toContain(
			(await workerFetch("/api/admin/kv/inspect?key=settings%3Aall")).status,
		);
	});

	describe("GET /api/admin/kv/overview", () => {
		test("returns 200 with registry-derived family rows", async () => {
			const res = await adminGet("/api/admin/kv/overview");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data?: { families?: Array<{ family: string }> };
			};
			const families = body.data?.families ?? [];
			expect(Array.isArray(families)).toBe(true);
			expect(families.length).toBeGreaterThan(0);
			expect(families.map((f) => f.family)).toContain("forum:summary:v2");
		});
	});

	describe("GET /api/admin/kv/list", () => {
		test("returns 200 + keys array for a public family", async () => {
			const res = await adminGet("/api/admin/kv/list?family=forum:summary:v2&limit=5");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data?: { family?: string; keys?: unknown[]; listComplete?: boolean };
			};
			expect(body.data?.family).toBe("forum:summary:v2");
			expect(Array.isArray(body.data?.keys)).toBe(true);
			expect(typeof body.data?.listComplete).toBe("boolean");
		});

		test("rejects unknown family with 404", async () => {
			const res = await adminGet("/api/admin/kv/list?family=does-not-exist");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/admin/kv/get", () => {
		test("rejects key from a hidden-name family with 403", async () => {
			// `refresh:<token>` family declares nameSensitivity:"hide" — the
			// handler refuses without ever reading KV.
			const res = await adminGet("/api/admin/kv/get?key=refresh:fake-token");
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code).toBe("KV_KEY_NAME_HIDDEN");
		});

		test("returns 4xx for a key that resolves to no registered family", async () => {
			const res = await adminGet("/api/admin/kv/get?key=__no_such_family__:zzz");
			expect([400, 404]).toContain(res.status);
		});
	});

	describe("POST /api/admin/kv/refresh", () => {
		test("rejects action kind that does not match the family", async () => {
			const res = await adminPost("/api/admin/kv/refresh", {
				family: "forum:summary:v2",
				action: { kind: "bump-thread-list-all" },
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code).toBe("KV_ACTION_MISMATCH");
		});

		test("happy path: bump-forum-summary returns ok+newGen", async () => {
			const res = await adminPost("/api/admin/kv/refresh", {
				family: "forum:summary:v2",
				action: { kind: "bump-forum-summary" },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data?: { ok?: boolean; newGen?: string };
			};
			expect(body.data?.ok).toBe(true);
			expect(typeof body.data?.newGen).toBe("string");
			expect((body.data?.newGen ?? "").length).toBeGreaterThan(0);
		});
	});

	describe("GET /api/admin/kv/metrics", () => {
		test("returns 200 with op-dimensioned series rows", async () => {
			const res = await adminGet("/api/admin/kv/metrics?minutes=5");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data?: { series?: Array<Record<string, unknown>> };
			};
			expect(Array.isArray(body.data?.series)).toBe(true);
			// We do not assert non-empty — a fresh Worker isolate may not
			// have flushed yet. Shape contract is: each row carries
			// (family, tsMinute, op, count) and never the legacy
			// {hits,misses,errors} wide shape.
			for (const row of body.data?.series ?? []) {
				expect(typeof row.family).toBe("string");
				expect(typeof row.tsMinute).toBe("number");
				expect(typeof row.op).toBe("string");
				expect(typeof row.count).toBe("number");
			}
		});
	});
});
