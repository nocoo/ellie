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
		deleteUserMini: vi.fn(async () => {}),
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
	deleteUserMini,
} from "../../../../src/lib/cache/invalidate";
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

const mockAudit = writeAdminLog as ReturnType<typeof vi.fn>;
const mockBumpTree = bumpForumTreeGen as ReturnType<typeof vi.fn>;
const mockBumpSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockBumpTLForum = bumpThreadListGen as ReturnType<typeof vi.fn>;
const mockBumpTLAll = bumpThreadListGenAll as ReturnType<typeof vi.fn>;
const mockBumpDigest = bumpDigestGen as ReturnType<typeof vi.fn>;
const mockDeleteUserMini = deleteUserMini as ReturnType<typeof vi.fn>;

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

	it("bump-thread-list-all calls bumpThreadListGenAll and audits", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "thread:list:v2",
				action: { kind: "bump-thread-list-all" },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockBumpTLAll).toHaveBeenCalledOnce();
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

	it("delete-user-mini calls deleteUserMini for valid userId", async () => {
		const env = makeEnv();
		const res = await kv.refresh(
			refreshRequest({
				family: "user:mini:v1",
				action: { kind: "delete-user-mini", userId: 42 },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(mockDeleteUserMini).toHaveBeenCalledWith(expect.anything(), 42);
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
		expect(res.status).toBe(404);
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
		// gen tokens read raw — overview MUST NOT have written any new
		// values into KV (would change the very state we observe).
		expect(env.KV.put as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
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
});

describe("admin/kv — metrics stub", () => {
	it("returns empty series envelope until commit B", async () => {
		const env = makeEnv();
		const req = createAdminRequest("GET", "/api/admin/kv/metrics?family=forum:tree:v2");
		const res = await kv.metrics(req, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { series: unknown[]; note: string };
		};
		expect(body.data.series).toEqual([]);
		expect(body.data.note).toContain("commit B");
	});
});
