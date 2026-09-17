// Unit tests for `apps/worker/src/handlers/admin/kv.ts`.
//
// Coverage focus (commit A):
//   - Sensitivity gates: hide / mask / no-read all enforced server-side.
//   - Action dispatcher: family + action.kind mismatch → 400.
//   - getKey: returns parsed JSON when value is JSON, raw when not;
//     refuses no-read families.
//   - listFamily: refuses hide families; masks names on mask families.
//   - refresh: each typed action calls the matching bumpGen / delete
//     helper and writes an audit log row.
//
// We deliberately do NOT exercise:
//   - The OVERVIEW_HARD_CAP / pagination loop (covered indirectly).
//   - The metrics endpoint (it's a stub until commit B).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/adminLog", async () => {
	const actual = await vi.importActual<typeof import("../../../../src/lib/adminLog")>(
		"../../../../src/lib/adminLog",
	);
	return {
		...actual,
		writeAdminLog: vi.fn(async () => {}),
	};
});

vi.mock("../../../../src/lib/cache/wrap", async () => {
	const actual = await vi.importActual<typeof import("../../../../src/lib/cache/wrap")>(
		"../../../../src/lib/cache/wrap",
	);
	return {
		...actual,
		settleCacheLoads: vi.fn(actual.settleCacheLoads),
	};
});

vi.mock("../../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../../src/lib/cache/invalidate")>(
		"../../../../src/lib/cache/invalidate",
	);
	return {
		...actual,
		bumpForumTreeGen: vi.fn(async () => "newgen-tree"),
		bumpForumSummaryGen: vi.fn(async () => "newgen-summary"),
		bumpThreadListGen: vi.fn(async (_e: unknown, fid: number) => `newgen-tl-${fid}`),
		bumpThreadListGenAll: vi.fn(async () => "newgen-tl-all"),
		bumpThreadMetaGen: vi.fn(async () => "newgen-tm"),
		bumpPostListGen: vi.fn(async () => "newgen-pl"),
		bumpDigestGen: vi.fn(async () => "newgen-digest"),
		// `deleteUserMini` (v2) is intentionally NOT mocked here: the live
		// `user:mini:v1` admin path goes through `lib/user-cache.ts ::
		// invalidateUserCache`, which we explicitly do NOT mock so the
		// integration-style test below exercises the real key deletion.
	};
});

import * as kv from "../../../../src/handlers/admin/kv";
import { writeAdminLog } from "../../../../src/lib/adminLog";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
} from "../../../../src/lib/cache/invalidate";
import { settleCacheLoads } from "../../../../src/lib/cache/wrap";
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

const mockAudit = writeAdminLog as ReturnType<typeof vi.fn>;
const mockBumpTree = bumpForumTreeGen as ReturnType<typeof vi.fn>;
const mockBumpSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockBumpTLForum = bumpThreadListGen as ReturnType<typeof vi.fn>;
const mockBumpTLAll = bumpThreadListGenAll as ReturnType<typeof vi.fn>;
const mockBumpDigest = bumpDigestGen as ReturnType<typeof vi.fn>;
const mockSettle = settleCacheLoads as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

function refreshRequest(body: unknown): Request {
	return createAdminRequest("POST", "/api/admin/kv/refresh", body);
}

describe("admin/kv — refresh dispatcher", () => {
	it("rejects mismatched action.kind for the family", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "forum:tree:v2", action: { kind: "bump-digest" } }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("KV_ACTION_MISMATCH");
		expect(mockBumpTree).not.toHaveBeenCalled();
	});

	it("treats '!unavailable' generation bump as a failed group invalidate", async () => {
		mockBumpTree.mockResolvedValueOnce("!unavailable");
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "forum:tree:v2", action: { kind: "bump-forum-tree" } }),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { outcome: string; ok: boolean; error?: { code: string } };
		};
		expect(body.data.ok).toBe(false);
		expect(body.data.outcome).toBe("failed");
		expect(body.data.error?.code).toBe("KV_INVALIDATE_UNAVAILABLE");
	});

	it("bump-forum-tree calls bumpForumTreeGen and audits", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "forum:tree:v2", action: { kind: "bump-forum-tree" } }),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockBumpTree).toHaveBeenCalledOnce();
		expect(mockAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				action: "kv.bump_gen",
				targetType: "kv_family",
				details: expect.objectContaining({ gen: "forum:tree:gen" }),
			}),
		);
	});

	it("bump-forum-summary calls bumpForumSummaryGen and audits", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "forum:summary:v2",
				action: { kind: "bump-forum-summary" },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockBumpSummary).toHaveBeenCalledOnce();
	});

	it("thread:list:v2 rejects bump-thread-list-all (mismatch — global op lives on gen family)", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "thread:list:v2",
				action: { kind: "bump-thread-list-all" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("KV_ACTION_MISMATCH");
		expect(mockBumpTLAll).not.toHaveBeenCalled();
	});

	it("bump-thread-list-forum requires forumId integer > 0", async () => {
		const env = makeEnv();
		const bad = await kv.refresh(
			refreshRequest({
				family: "gen:thread:list:per-forum",
				action: { kind: "bump-thread-list-forum" },
			}),
			env,
		);
		expect(bad.status).toBe(400);
		expect(mockBumpTLForum).not.toHaveBeenCalled();

		const good = await kv.refresh(
			refreshRequest({
				family: "gen:thread:list:per-forum",
				action: { kind: "bump-thread-list-forum", forumId: 7 },
			}),
			env,
		);
		expect(good.status).toBe(200);
		expect(mockBumpTLForum).toHaveBeenCalledWith(expect.anything(), 7);
		expect(mockAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ targetId: 7 }),
		);
	});

	it("bump-digest calls bumpDigestGen", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "gen:digest", action: { kind: "bump-digest" } }),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockBumpDigest).toHaveBeenCalledOnce();
	});

	it("delete-literal refuses keys whose family doesn't match", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "settings:all",
				action: { kind: "delete-literal", key: "public-stats" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("KV_KEY_FAMILY_MISMATCH");
	});

	it("delete-literal deletes the key and audits when family matches", async () => {
		const env = makeEnv({ KV: createMockKV({ "settings:all": '{"a":1}' }) });
		const res = await kv.refresh(
			refreshRequest({
				family: "settings:all",
				action: { kind: "delete-literal", key: "settings:all" },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect((env.KV.delete as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("settings:all");
		expect(mockAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ action: "kv.delete_key", targetType: "kv_key" }),
		);
	});

	it("delete-user-mini removes the live `user:mini:<id>` key (no helper mock)", async () => {
		// Reviewer-required regression: B.1 was deleting `user:mini:v2:<id>`
		// because the handler called the v2 helper. The live family is v1
		// with literal key `user:mini:<id>`. Seed that key and assert the
		// admin refresh path actually evicts it via the real
		// `invalidateUserCache` (no mock).
		const env = makeEnv({
			KV: createMockKV({
				"user:mini:42": '{"id":42,"username":"alice"}',
				"user:mini:43": '{"id":43,"username":"bob"}',
			}),
		});
		const res = await kv.refresh(
			refreshRequest({
				family: "user:mini:v1",
				action: { kind: "delete-user-mini", userId: 42 },
			}),
			env,
		);
		expect(res.status).toBe(200);
		// The literal v1 key must be the one passed to KV.delete.
		const deleteCalls = (env.KV.delete as ReturnType<typeof vi.fn>).mock.calls;
		expect(deleteCalls.some((c) => c[0] === "user:mini:42")).toBe(true);
		// And it must be gone after the call.
		expect(await env.KV.get("user:mini:42")).toBeNull();
		// Sibling user must remain.
		expect(await env.KV.get("user:mini:43")).not.toBeNull();
	});

	it("rejects unknown family", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "bogus:family", action: { kind: "bump-digest" } }),
			env,
		);
		expect(res.status).toBe(404);
	});

	it("rejects unparseable body", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/admin/kv/refresh", {
			method: "POST",
			headers: { "X-API-Key": "test-admin-api-key", "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await kv.refresh(req, env);
		expect(res.status).toBe(400);
	});
});

describe("admin/kv — getKey sensitivity gates", () => {
	it("refuses hidden-name family (refresh tokens)", async () => {
		const env = makeEnv({
			KV: createMockKV({ "refresh:supersecret": "1" }),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=refresh:supersecret");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("KV_KEY_NAME_HIDDEN");
	});

	it("refuses no-read value family (email_verify)", async () => {
		const env = makeEnv({
			KV: createMockKV({ "email_verify:42": '{"code":"123"}' }),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=email_verify:42");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("KV_KEY_VALUE_FORBIDDEN");
	});

	it("returns parsed JSON for cache key", async () => {
		const env = makeEnv({
			KV: createMockKV({ "settings:all": '{"siteName":"test"}' }),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=settings:all");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { value: { siteName: string }; rawKey: string };
		};
		expect(body.data.value.siteName).toBe("test");
		expect(body.data.rawKey).toBe("settings:all");
	});

	it("returns 404 for missing key", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=settings:all");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { found: boolean; status: string; valid: boolean } };
		expect(body.data.found).toBe(false);
		expect(body.data.valid).toBe(false);
		expect(body.data.status).toBe("not-found");
	});

	it("returns 404 for unknown family", async () => {
		const env = makeEnv({ KV: createMockKV({ "weird:key": "x" }) });
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=weird:key");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(404);
	});
});

describe("admin/kv — listFamily", () => {
	it("refuses hide family", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=refresh");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(403);
	});

	it("masks IP suffix on rate-limit family", async () => {
		const env = makeEnv({
			KV: createMockKV({ "login-ip:192.168.1.42": "5" }),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=login-ip");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { keys: { key: string; rawKey: string | null }[] };
		};
		expect(body.data.keys[0].key).toBe("login-ip:192.168.*.*");
		expect(body.data.keys[0].rawKey).toBeNull();
	});

	it("returns raw key for public-name family", async () => {
		const env = makeEnv({
			KV: createMockKV({ "user:mini:42": '{"id":42}' }),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=user:mini:v1");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { keys: { key: string; rawKey: string | null }[] };
		};
		expect(body.data.keys[0].rawKey).toBe("user:mini:42");
	});

	it("returns 400 for missing family", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/list");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(400);
	});

	it("singleton (exact) family returns at most one key", async () => {
		// `settings:all` is exact; `settings:all:v2:foo` must NOT show up.
		const env = makeEnv({
			KV: createMockKV({
				"settings:all": '{"siteName":"x"}',
				"settings:all:v2:foo": "should-not-appear",
			}),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=settings:all");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { keys: { rawKey: string | null }[]; listComplete: boolean };
		};
		expect(body.data.keys).toHaveLength(1);
		expect(body.data.keys[0].rawKey).toBe("settings:all");
		expect(body.data.listComplete).toBe(true);
	});

	it("singleton family returns empty when missing", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=public-stats");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { keys: unknown[] } };
		expect(body.data.keys).toEqual([]);
	});

	it("lists singleton metadata without reading the body", async () => {
		const kvStore = createMockKV();
		await kvStore.put("settings:all", '{"siteName":"secret"}', {
			metadata: { contentUtf8Bytes: 21, expiresAt: 9, schemaVersion: 3 },
		});
		const env = makeEnv({ KV: kvStore });
		const res = await kv.listFamily(
			createAdminRequest("GET", "/api/admin/kv/list?family=settings:all"),
			env,
		);
		expect(res.status).toBe(200);
		expect(kvStore.get).not.toHaveBeenCalled();
		const body = (await res.json()) as {
			data: {
				keys: {
					rawKey: string | null;
					contentUtf8Bytes: number | null;
					schemaVersion: number | null;
				}[];
				countKind: string;
			};
		};
		expect(body.data.countKind).toBe("observed");
		expect(body.data.keys[0]).toMatchObject({
			rawKey: "settings:all",
			contentUtf8Bytes: 21,
			schemaVersion: 3,
		});
	});

	it("does not treat an exact miss past sibling scan as observed zero", async () => {
		const kvStore = createMockKV();
		kvStore.list = vi.fn(async (opts: { prefix?: string } = {}) => {
			if (opts.prefix === "settings:all") {
				return {
					keys: Array.from({ length: 32 }, (_, i) => ({ name: `settings:all:sib${i}` })),
					list_complete: false,
					cursor: "more",
				};
			}
			return { keys: [], list_complete: true, cursor: "" };
		}) as unknown as KVNamespace["list"];
		const env = makeEnv({ KV: kvStore });
		const res = await kv.listFamily(
			createAdminRequest("GET", "/api/admin/kv/list?family=settings:all"),
			env,
		);
		const body = (await res.json()) as {
			data: { keys: unknown[]; countKind: string; listComplete: boolean };
		};
		expect(kvStore.get).not.toHaveBeenCalled();
		expect(body.data.keys).toEqual([]);
		expect(body.data.countKind).toBe("unknown");
		expect(body.data.listComplete).toBe(false);
	});

	it("locates a hashed family by params and scope without a value GET", async () => {
		const kvStore = createMockKV({ "user:mini:42": '{"id":42}' });
		const env = makeEnv({ KV: kvStore });
		const params = encodeURIComponent(JSON.stringify({ id: 42 }));
		const res = await kv.listFamily(
			createAdminRequest(
				"GET",
				`/api/admin/kv/list?family=user:mini:v1&params=${params}&scope=public`,
			),
			env,
		);
		expect(res.status).toBe(200);
		expect(kvStore.get).not.toHaveBeenCalled();
		const body = (await res.json()) as {
			data: {
				keys: { rawKey: string | null; params: unknown; scope: string | null }[];
				countKind: string;
			};
		};
		expect(body.data.countKind).toBe("observed");
		expect(body.data.keys).toEqual([
			expect.objectContaining({
				rawKey: "user:mini:42",
				params: { id: 42 },
				scope: "public",
			}),
		]);
	});

	it("rejects mixing a full key with params, and invalid param JSON", async () => {
		const env = makeEnv();
		const mixed = await kv.listFamily(
			createAdminRequest(
				"GET",
				"/api/admin/kv/list?family=user:mini:v1&key=user:mini:1&params=%7B%22id%22%3A1%7D",
			),
			env,
		);
		expect(mixed.status).toBe(400);
		const bad = await kv.listFamily(
			createAdminRequest("GET", "/api/admin/kv/list?family=user:mini:v1&params=not-json"),
			env,
		);
		expect(bad.status).toBe(400);
	});
});

describe("admin/kv — getKey mask-value gating", () => {
	it("never returns raw value for mask-value family (login-ip)", async () => {
		const env = makeEnv({ KV: createMockKV({ "login-ip:1.2.3.4": "5" }) });
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=login-ip:1.2.3.4");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { value: unknown; valueMasked: boolean; valueByteSize: number; rawKey: string | null };
		};
		expect(body.data.value).toBeNull();
		expect(body.data.valueMasked).toBe(true);
		expect(body.data.valueByteSize).toBe(1);
		expect(body.data.rawKey).toBeNull();
	});
});

describe("admin/kv — bump-thread-list-all routes the global gen", () => {
	it("dispatches via family gen:thread:list:all (not per-forum)", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "gen:thread:list:all",
				action: { kind: "bump-thread-list-all" },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockBumpTLAll).toHaveBeenCalledOnce();
	});
});

describe("admin/kv — overview presence + no gen seeding", () => {
	it("annotates rows with presence and never writes gen tokens", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/overview");
		const res = await kv.overview(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				families: {
					family: string;
					status: string;
					count: number;
					presence: string;
					currentGens?: { name: string; value: string | null }[];
				}[];
			};
		};
		// shipped-empty → "absent"; planned → "planned"; dead-builder → "dead-builder-reserved".
		const settings = body.data.families.find((f) => f.family === "settings:all");
		expect(settings?.presence).toBe("absent");
		const planned = body.data.families.find((f) => f.family === "user:mini:v2");
		expect(planned?.presence).toBe("planned");
		const dead = body.data.families.find((f) => f.family === "settings:all:v2");
		expect(dead?.presence).toBe("dead-builder-reserved");
		// Hide-name shipped with 0 keys is "absent" too.
		const refreshRow = body.data.families.find((f) => f.family === "refresh");
		expect(refreshRow?.presence).toBe("absent");
		// Overview may fill the monitor snapshot, but must never seed gen tokens.
		const puts = (env.KV.put as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
		expect(puts.every((key) => key.startsWith("cache:v3:monitor:"))).toBe(true);
		// Forum-tree row should expose gen value as null when missing.
		const tree = body.data.families.find((f) => f.family === "forum:tree:v2");
		expect(tree?.currentGens?.[0].value).toBeNull();
	});

	it("counts non-singleton family with masked sample keys", async () => {
		const env = makeEnv({
			KV: createMockKV({
				"online:1": JSON.stringify({ at: 1 }),
				"online:2": JSON.stringify({ at: 2 }),
			}),
		});
		const req = createAdminRequest("GET", "/api/admin/kv/overview");
		const res = await kv.overview(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { families: { family: string; count: number; sampleKeys: string[] }[] };
		};
		const onlineRow = body.data.families.find((f) => f.family === "online:user");
		expect(onlineRow?.count).toBe(2);
		// `online:user` is mask, so sample keys must be hashed not raw.
		expect(onlineRow?.sampleKeys.every((k) => k.startsWith("online:u_"))).toBe(true);
	});
});

describe("admin/kv — refresh: per-thread bumpers", () => {
	it("bump-thread-meta requires positive integer threadId", async () => {
		const env = makeEnv();
		const bad = await kv.refresh(
			refreshRequest({
				family: "gen:thread:meta",
				action: { kind: "bump-thread-meta" },
			}),
			env,
		);
		expect(bad.status).toBe(400);
		const good = await kv.refresh(
			refreshRequest({
				family: "gen:thread:meta",
				action: { kind: "bump-thread-meta", threadId: 9 },
			}),
			env,
		);
		expect(good.status).toBe(200);
	});

	it("bump-post-list requires positive integer threadId", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "gen:post:list",
				action: { kind: "bump-post-list", threadId: 11 },
			}),
			env,
		);
		expect(res.status).toBe(200);
	});

	it("delete-user-mini rejects bad userId", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "user:mini:v1",
				action: { kind: "delete-user-mini", userId: -1 },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("delete-literal rejects empty key", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "settings:all",
				action: { kind: "delete-literal", key: "" },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rejects refresh on a `none`-action family (refresh tokens)", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({ family: "refresh", action: { kind: "none" } }),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rejects missing family in body", async () => {
		const env = makeEnv();
		const res = await kv.refresh(refreshRequest({ action: { kind: "bump-digest" } }), env);
		expect(res.status).toBe(400);
	});
});

describe("admin/kv — getKey misc", () => {
	it("inspects by params and scope when the hashed key is not supplied", async () => {
		const env = makeEnv({ KV: createMockKV({ "user:mini:42": '{"id":42,"username":"n"}' }) });
		const params = encodeURIComponent(JSON.stringify({ id: 42 }));
		const res = await kv.getKey(
			createAdminRequest(
				"GET",
				`/api/admin/kv/get?family=user:mini:v1&params=${params}&scope=public`,
			),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { rawKey: string | null; found: boolean } };
		expect(body.data.rawKey).toBe("user:mini:42");
		expect(body.data.found).toBe(true);
	});

	it("returns 400 when key query param is missing", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/get");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(400);
	});

	it("returns raw string when value is not JSON", async () => {
		const env = makeEnv({ KV: createMockKV({ "stats:online_count": "42" }) });
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=stats:online_count");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { value: unknown; valueMasked: boolean } };
		expect(body.data.value).toBe(42); // JSON.parse("42") → 42
		expect(body.data.valueMasked).toBe(false);
	});
});

describe("admin/kv — listFamily misc", () => {
	it("returns 404 for unknown family", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=does-not-exist");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(404);
	});

	it("paginated list honors per-page limit", async () => {
		const initial: Record<string, string> = {};
		for (let i = 0; i < 5; i++) initial[`user:mini:${i}`] = `{"id":${i}}`;
		const env = makeEnv({ KV: createMockKV(initial) });
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=user:mini:v1&limit=2");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { keys: unknown[]; cursor: string | null; listComplete: boolean };
		};
		expect(body.data.keys).toHaveLength(2);
		expect(body.data.listComplete).toBe(false);
		expect(body.data.cursor).not.toBeNull();
	});

	it("loops across pages when overlapping-prefix siblings dominate the first page", async () => {
		// `user:mini:v1` family lives under prefix `user:mini:` but
		// `user:mini:v2:*` keys sort lexicographically AFTER `user:mini:zzz`?
		// Actually `v2:` (0x76) > `zzz` is false: 'v' < 'z'. So put a v1
		// key whose suffix sorts AFTER v2 siblings and ask for limit=1.
		// Mock KV sorts by name → first page (limit=1) returns the v2
		// sibling, which is filtered out. Loop must fetch the next page
		// and surface the v1 key.
		const initial: Record<string, string> = {
			"user:mini:v2:0001": '{"id":1}', // sibling, owned by user:mini:v2
			"user:mini:zzz": '{"id":99}', // owned by user:mini:v1 (sorts after v2:*)
		};
		const env = makeEnv({ KV: createMockKV(initial) });
		const req = createAdminRequest("GET", "/api/admin/kv/list?family=user:mini:v1&limit=1");
		const res = await kv.listFamily(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { keys: { rawKey: string | null }[]; listComplete: boolean };
		};
		expect(body.data.keys).toHaveLength(1);
		expect(body.data.keys[0].rawKey).toBe("user:mini:zzz");
	});
});

describe("admin/kv — overview", () => {
	it("returns one row per registry family", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/overview");
		const res = await kv.overview(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				families: {
					family: string;
					count: number;
					sampleKeys: string[];
					nameSensitivity: string;
				}[];
			};
		};
		// Each family appears exactly once.
		const families = body.data.families.map((f) => f.family);
		expect(new Set(families).size).toBe(families.length);
		// Hidden families never expose sample keys, even if present.
		const refreshRow = body.data.families.find((f) => f.family === "refresh");
		expect(refreshRow?.sampleKeys).toEqual([]);
	});

	it("does not stamp a later occupancy minute from a cached overview", async () => {
		const { __resetMetricsForTest, swapSnapshot } = await import(
			"../../../../src/lib/cache/metrics"
		);
		vi.useFakeTimers();
		try {
			const origin = 1_700_000_000_000;
			vi.setSystemTime(origin);
			__resetMetricsForTest();
			const kvStore = createMockKV({ "settings:all": "{}" });
			const env = makeEnv({ KV: kvStore });
			const first = await kv.overview(createAdminRequest("GET", "/api/admin/kv/overview"), env);
			expect(first.status).toBe(200);
			const firstBody = (await first.json()) as { data: { observedAt: number } };
			expect(firstBody.data.observedAt).toBe(origin);
			const minuteT = Math.floor(origin / 60_000);
			const warm = swapSnapshot();
			expect(
				[...warm.keys()].some(
					(key) => key.startsWith("footprint:") && key.includes(`\u0001${minuteT}\u0001`),
				),
			).toBe(true);
			vi.mocked(kvStore.list).mockClear();
			vi.setSystemTime(origin + 61_000);
			const second = await kv.overview(createAdminRequest("GET", "/api/admin/kv/overview"), env);
			expect(second.status).toBe(200);
			const secondBody = (await second.json()) as { data: { observedAt: number } };
			expect(secondBody.data.observedAt).toBe(origin);
			expect(kvStore.list).not.toHaveBeenCalled();
			const laterMinute = Math.floor((origin + 61_000) / 60_000);
			expect(laterMinute).not.toBe(minuteT);
			const hot = swapSnapshot();
			expect(
				[...hot.keys()].some(
					(key) => key.startsWith("footprint:") && key.includes(`\u0001${laterMinute}\u0001`),
				),
			).toBe(false);
		} finally {
			vi.useRealTimers();
			__resetMetricsForTest();
		}
	});
});

describe("admin/kv — metrics", () => {
	it("returns op-dimensioned rows from kv_cache_metrics_minute filtered by family + minutes", async () => {
		const tsNow = Math.floor(Date.now() / 60_000);
		const rows = [
			{ family: "forum:tree:v2", ts_minute: tsNow - 1, op: "read", count: 5 },
			{ family: "forum:tree:v2", ts_minute: tsNow - 1, op: "hit", count: 4 },
			{ family: "forum:tree:v2", ts_minute: tsNow - 1, op: "miss", count: 1 },
			{ family: "forum:tree:v2", ts_minute: tsNow, op: "write", count: 2 },
		];
		// Mock D1 that returns the seeded rows for the metrics query
		// regardless of bind args; assertion is on response shape.
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ success: true, results: rows }),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("GET", "/api/admin/kv/metrics?family=forum:tree:v2&minutes=15");
		const res = await kv.metrics(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				family: string | null;
				minutes: number;
				series: { family: string; tsMinute: number; op: string; count: number }[];
			};
		};
		expect(body.data.family).toBe("forum:tree:v2");
		expect(body.data.minutes).toBe(15);
		expect(body.data.series).toHaveLength(4);
		// Op + count round-trip through the response shape.
		expect(body.data.series[0].op).toBe("read");
		expect(body.data.series[0].count).toBe(5);
		expect(body.data.series[3].op).toBe("write");
		expect(body.data.series[3].count).toBe(2);
	});

	it("passes through application:d1 observation from the same metrics table, no extra SQL", async () => {
		const tsNow = Math.floor(Date.now() / 60_000);
		const rows = [
			{ family: "application:d1", ts_minute: tsNow, op: "d1-query", count: 4 },
			{ family: "application:d1", ts_minute: tsNow, op: "d1-duration-ms", count: 18 },
			{ family: "application:d1", ts_minute: tsNow, op: "d1-rows-read", count: 22 },
		];
		const sql: string[] = [];
		const db = {
			prepare: (query: string) => {
				sql.push(query);
				expect(query).toContain("kv_cache_metrics_minute");
				expect(query).not.toContain("sqlite_master");
				expect(query.toLowerCase()).not.toContain("pragma");
				return {
					bind: () => ({
						all: async () => ({ success: true, results: rows }),
					}),
				};
			},
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const res = await kv.metrics(
			createAdminRequest("GET", "/api/admin/kv/metrics?minutes=60"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { series: { family: string; op: string; count: number }[] };
		};
		expect(sql).toHaveLength(1);
		expect(body.data.series.map((r) => r.op)).toEqual([
			"d1-query",
			"d1-duration-ms",
			"d1-rows-read",
		]);
	});

	it("degrades gracefully when D1 query throws (table missing)", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => {
						throw new Error("no such table: kv_cache_metrics_minute");
					},
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("GET", "/api/admin/kv/metrics");
		const res = await kv.metrics(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { series: unknown[]; note?: string };
		};
		expect(body.data.series).toEqual([]);
		expect(body.data.note).toContain("metrics table unavailable");
	});
});

describe("admin/kv — inspect lifecycle without side effects", () => {
	it("returns authorized envelope data, utf-8 size, and does not write", async () => {
		const now = Date.now();
		const envelope = {
			schemaVersion: 3,
			family: "settings:all",
			tier: "MEDIUM",
			loadedAt: now - 1_000,
			expiresAt: now + 60_000,
			data: { siteName: "preview" },
			params: {},
			scope: "public",
		};
		const env = makeEnv({ KV: createMockKV({ "settings:all": JSON.stringify(envelope) }) });
		const req = createAdminRequest("GET", "/api/admin/kv/get?key=settings:all");
		const res = await kv.getKey(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				value: { siteName: string };
				status: string;
				contentUtf8Bytes: number;
				footprint: { kind: string; bytes: number };
				valid: boolean;
				scope: string;
			};
		};
		expect(body.data.value.siteName).toBe("preview");
		expect(body.data.scope).toBe("public");
		if (body.data.valid) expect(body.data.status).toBe("valid");
		else expect(body.data.status).not.toBe("valid");
		expect(body.data.contentUtf8Bytes).toBeGreaterThan(0);
		expect(body.data.footprint.kind).toBe("observed");
		expect(env.KV.put as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it("returns read-failed without filling when KV get throws", async () => {
		const env = makeEnv({ KV: createMockKV({ "settings:all": '{"siteName":"x"}' }) });
		(env.KV.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("kv down"));
		const res = await kv.getKey(
			createAdminRequest("GET", "/api/admin/kv/get?key=settings:all"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { status: string; found: boolean; valid: boolean } };
		expect(body.data.status).toBe("read-failed");
		expect(body.data.found).toBe(false);
		expect(body.data.valid).toBe(false);
		expect(env.KV.put as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it("previews internal scope on the admin inspect path only", async () => {
		const now = Date.now();
		const envelope = {
			schemaVersion: 3,
			family: "settings:all",
			tier: "LONG",
			loadedAt: now - 1_000,
			expiresAt: now + 60_000,
			data: { secret: "admin-only" },
			params: {},
			scope: "internal",
		};
		const env = makeEnv({ KV: createMockKV({ "settings:all": JSON.stringify(envelope) }) });
		const res = await kv.getKey(
			createAdminRequest("GET", "/api/admin/kv/get?key=settings:all"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { scope: string; adminOnlyPreview: boolean; value: { secret: string } };
		};
		expect(body.data.scope).toBe("internal");
		expect(body.data.adminOnlyPreview).toBe(true);
		expect(body.data.value.secret).toBe("admin-only");
	});

	it("marks logically expired envelope as diagnostic, still no loader write", async () => {
		const envelope = {
			schemaVersion: 3,
			family: "settings:all",
			tier: "SHORT",
			loadedAt: 1,
			expiresAt: 2,
			data: { siteName: "old" },
			params: {},
			scope: "public",
		};
		const env = makeEnv({ KV: createMockKV({ "settings:all": JSON.stringify(envelope) }) });
		const res = await kv.getKey(
			createAdminRequest("GET", "/api/admin/kv/get?key=settings:all"),
			env,
		);
		const body = (await res.json()) as {
			data: { status: string; value: { siteName: string }; valid: boolean };
		};
		expect(body.data.status).toBe("logically-expired");
		expect(body.data.valid).toBe(false);
		expect(body.data.value.siteName).toBe("old");
		expect(env.KV.put as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});
});

describe("admin/kv — per-entry delete vs group invalidate", () => {
	it("deletes only the target business key and does not bump a generation", async () => {
		const { __resetMetricsForTest, swapSnapshot } = await import(
			"../../../../src/lib/cache/metrics"
		);
		__resetMetricsForTest();
		const env = makeEnv({
			KV: createMockKV({
				"forum:tree:v2:anon:g1": '{"ok":true}',
				"forum:tree:v2:member:g1": '{"ok":true}',
			}),
		});
		const res = await kv.deleteEntry(
			createAdminRequest("POST", "/api/admin/kv/delete", {
				family: "forum:tree:v2",
				key: "forum:tree:v2:anon:g1",
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { outcome: string; deletedKeys: string[] } };
		expect(body.data.outcome).toBe("deleted");
		expect(body.data.deletedKeys).toEqual(["forum:tree:v2:anon:g1"]);
		expect(mockBumpTree).not.toHaveBeenCalled();
		expect(await env.KV.get("forum:tree:v2:anon:g1")).toBeNull();
		expect(await env.KV.get("forum:tree:v2:member:g1")).not.toBeNull();
		const keys = [...swapSnapshot().keys()];
		expect(keys.some((key) => key.startsWith("admin:forum:tree:v2"))).toBe(true);
		expect(keys.some((key) => key.startsWith("forum:tree:v2\u0001"))).toBe(false);
	});

	it("refuses runtime-state keys instead of deleting credentials", async () => {
		const env = makeEnv({ KV: createMockKV({ "refresh:supersecret": "1" }) });
		const res = await kv.deleteEntry(
			createAdminRequest("POST", "/api/admin/kv/delete", {
				family: "refresh",
				key: "refresh:supersecret",
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { outcome: string } };
		expect(body.data.outcome).toBe("not-allowed");
		expect(await env.KV.get("refresh:supersecret")).toBe("1");
	});
});

describe("admin/kv — rebuild is not a generation bump", () => {
	it("does not bump a generation or delete a valid snapshot when rebuild cannot load", async () => {
		const env = makeEnv({ KV: createMockKV({ "settings:all": '{"siteName":"x"}' }) });
		const res = await kv.rebuild(
			createAdminRequest("POST", "/api/admin/kv/rebuild", {
				family: "settings:all",
				key: "settings:all",
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { outcome: string; error?: { code: string }; stage?: string };
		};
		expect(body.data.outcome).toBe("failed");
		expect(body.data.error?.code).toBe("INVALID_DESCRIPTOR");
		expect(mockBumpTree).not.toHaveBeenCalled();
		expect(await env.KV.get("settings:all")).toBe('{"siteName":"x"}');
	});

	it("keeps the old snapshot when rebuild reports STALE_VERSION", async () => {
		const now = Date.now();
		const envelope = {
			schemaVersion: 3,
			family: "forum:tree:v2",
			tier: "LONG",
			loadedAt: now - 1_000,
			expiresAt: now + 3_600_000,
			data: { nodes: [] },
			params: { bucket: "anon" },
			scope: "role:anon",
		};
		const raw = JSON.stringify(envelope);
		const env = makeEnv({
			KV: createMockKV({ "forum:tree:v2:anon:gold": raw }),
		});
		const res = await kv.rebuild(
			createAdminRequest("POST", "/api/admin/kv/rebuild", {
				family: "forum:tree:v2",
				key: "forum:tree:v2:anon:gold",
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { outcome: string; error?: { code: string }; stage?: string };
		};
		expect(body.data.outcome).toBe("failed");
		expect(body.data.error?.code).toBe("STALE_VERSION");
		expect(body.data.stage).toBe("validate");
		expect(await env.KV.get("forum:tree:v2:anon:gold")).toBe(raw);
		expect(mockBumpTree).not.toHaveBeenCalled();
	});

	it("returns BUSY validate when a pending fill has not settled, and keeps the snapshot", async () => {
		const now = Date.now();
		const envelope = {
			schemaVersion: 3,
			family: "settings:all",
			tier: "LONG",
			loadedAt: now - 1_000,
			expiresAt: now + 60_000,
			data: { siteName: "still-here" },
			params: {},
			scope: "public",
		};
		const raw = JSON.stringify(envelope);
		mockSettle.mockRejectedValueOnce(new Error("fill timeout"));
		const env = makeEnv({ KV: createMockKV({ "settings:all": raw }) });
		const res = await kv.rebuild(
			createAdminRequest("POST", "/api/admin/kv/rebuild", {
				family: "settings:all",
				key: "settings:all",
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { outcome: string; error?: { code: string }; stage?: string };
		};
		expect(body.data.outcome).toBe("failed");
		expect(body.data.error?.code).toBe("BUSY");
		expect(body.data.stage).toBe("validate");
		expect(await env.KV.get("settings:all")).toBe(raw);
		expect(mockBumpTree).not.toHaveBeenCalled();
	});

	it("rejects caller-supplied params or scope on rebuild", async () => {
		const env = makeEnv({ KV: createMockKV({ "settings:all": '{"siteName":"x"}' }) });
		const res = await kv.rebuild(
			createAdminRequest("POST", "/api/admin/kv/rebuild", {
				family: "settings:all",
				key: "settings:all",
				params: { siteName: "injected" },
				scope: "admin",
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UNKNOWN_KEYS");
		expect(mockBumpTree).not.toHaveBeenCalled();
	});
});

describe("admin/kv — operations and metrics window", () => {
	it("does not treat a failed audit read as a healthy empty log", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ success: false, results: [] }),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const res = await kv.operations(createAdminRequest("GET", "/api/admin/kv/operations"), env);
		const body = (await res.json()) as {
			data: { rows: unknown[]; note?: string; listComplete?: boolean };
		};
		expect(body.data.rows).toEqual([]);
		expect(body.data.note).toContain("unavailable");
		expect(body.data.listComplete).toBe(false);
	});

	it("pages operations with createdAt/id cursor and limit+1", async () => {
		const { encodeGenericCursor } = await import("@ellie/types");
		const rows = [
			{
				id: 3,
				admin_id: 1,
				admin_name: "a",
				action: "kv.delete_key",
				target_type: "kv_key",
				target_id: null,
				details: "{}",
				created_at: 30,
			},
			{
				id: 2,
				admin_id: 1,
				admin_name: "a",
				action: "kv.rebuild",
				target_type: "kv_key",
				target_id: null,
				details: "{}",
				created_at: 20,
			},
			{
				id: 1,
				admin_id: 1,
				admin_name: "a",
				action: "kv.bump_gen",
				target_type: "kv_key",
				target_id: null,
				details: "{}",
				created_at: 10,
			},
		];
		const binds: unknown[][] = [];
		const db = {
			prepare: () => ({
				bind: (...args: unknown[]) => {
					binds.push(args);
					const limit = Number(args[args.length - 1]);
					const createdAt = args.length > 5 ? Number(args[4]) : Number.POSITIVE_INFINITY;
					const id = args.length > 5 ? Number(args[6]) : Number.POSITIVE_INFINITY;
					const filtered = rows.filter(
						(row) => row.created_at < createdAt || (row.created_at === createdAt && row.id < id),
					);
					return {
						all: async () => ({ success: true, results: filtered.slice(0, limit) }),
					};
				},
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const first = await kv.operations(
			createAdminRequest("GET", "/api/admin/kv/operations?limit=1"),
			env,
		);
		const firstBody = (await first.json()) as {
			data: { rows: { id: number }[]; cursor: string | null; listComplete: boolean };
		};
		expect(binds[0]?.[binds[0].length - 1]).toBe(2);
		expect(firstBody.data.rows.map((row) => row.id)).toEqual([3]);
		expect(firstBody.data.listComplete).toBe(false);
		expect(firstBody.data.cursor).toBe(encodeGenericCursor({ createdAt: 30, id: 3 }));
		const second = await kv.operations(
			createAdminRequest(
				"GET",
				`/api/admin/kv/operations?limit=2&cursor=${encodeURIComponent(firstBody.data.cursor ?? "")}`,
			),
			env,
		);
		const secondBody = (await second.json()) as {
			data: { rows: { id: number }[]; listComplete: boolean; cursor: string | null };
		};
		expect(secondBody.data.rows.map((row) => row.id)).toEqual([2, 1]);
		expect(secondBody.data.listComplete).toBe(true);
		expect(secondBody.data.cursor).toBeNull();
	});

	it("rejects a malformed operations cursor", async () => {
		const env = makeEnv();
		const res = await kv.operations(
			createAdminRequest("GET", "/api/admin/kv/operations?cursor=not-a-cursor"),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("returns empty operations when admin_logs is missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => {
						throw new Error("no such table: admin_logs");
					},
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const res = await kv.operations(createAdminRequest("GET", "/api/admin/kv/operations"), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { rows: unknown[]; note?: string } };
		expect(body.data.rows).toEqual([]);
		expect(body.data.note).toContain("unavailable");
	});

	it("accepts a 7-day metrics window without extra D1 stats SQL", async () => {
		const db = {
			prepare: (sql: string) => {
				expect(sql).toContain("kv_cache_metrics_minute");
				expect(sql).not.toContain("sqlite_master");
				expect(sql.toLowerCase()).not.toContain("pragma");
				return {
					bind: () => ({
						all: async () => ({ success: true, results: [] }),
					}),
				};
			},
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const res = await kv.metrics(
			createAdminRequest("GET", "/api/admin/kv/metrics?minutes=10080"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { minutes: number; source: string } };
		expect(body.data.minutes).toBe(10080);
		expect(body.data.source).toContain("application");
	});
});

describe("admin/kv — overview count kind", () => {
	it("labels truncated family counts as at-least, never unknown as 0 bytes", async () => {
		const env = makeEnv();
		const res = await kv.overview(createAdminRequest("GET", "/api/admin/kv/overview"), env);
		const body = (await res.json()) as {
			data: {
				families: {
					family: string;
					count: number;
					countKind: string;
					footprint: { kind: string; bytes: number | null };
				}[];
			};
		};
		const settings = body.data.families.find((f) => f.family === "settings:all");
		expect(settings?.countKind).toBe("observed");
		expect(settings?.footprint.kind).toBe("unknown");
		expect(settings?.footprint.bytes).toBeNull();
	});
});
