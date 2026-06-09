// Tests for PATCH /api/v1/forums/:id/announcement.
//
// Two-layer permission gate (per reviewer requirement 5):
//   - moderationMiddleware: role ∈ {Admin, SuperMod, Mod} + email verified + not banned
//   - canModerate(user, forum): forum-scope (Mod must be in forum.moderators list)
//
// Cache invalidation: tree + summary gens bumped (announcement is non-digest-affecting).

import { describe, expect, it } from "vitest";
import { setAnnouncement } from "../../../src/handlers/forum";
import { createJwt } from "../../../src/lib/jwt";
import { createMockDb, createMockKV, makeEnv, TEST_JWT_SECRET } from "../../helpers";

async function makeToken(role: number, userId = 1): Promise<string> {
	return createJwt({ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_JWT_SECRET);
}

function patchRequest(forumId: number, token: string | null, body?: unknown): Request {
	return new Request(`https://api.example.com/api/v1/forums/${forumId}/announcement`, {
		method: "PATCH",
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

function mockAuthRow(role = 1, status = 0, email_verified_at = 1700000000) {
	return {
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status,
			email_verified_at,
		},
	};
}

function mockUserRow(userId = 1, role = 1, username = "admin") {
	return {
		"SELECT id, username, role, status FROM users": { id: userId, username, role, status: 0 },
	};
}

function mockForumRow(forumId = 1, moderators = "") {
	return {
		"SELECT id, moderators, moderator_ids FROM forums": {
			id: forumId,
			moderators,
			moderator_ids: "",
		},
	};
}

// ─── Auth / role gate ────────────────────────────────────────────

describe("PATCH /api/v1/forums/:id/announcement — auth", () => {
	it("401 without auth", async () => {
		const env = makeEnv();
		const res = await setAnnouncement(patchRequest(1, null, { announcement: "x" }), env);
		expect(res.status).toBe(401);
	});

	it("403 FORBIDDEN_MOD_ONLY for regular user (role 0)", async () => {
		const token = await makeToken(0);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(0) } });
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("FORBIDDEN_MOD_ONLY");
	});

	it("403 USER_BANNED for banned mod", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(3, 1) } }); // status=1 banned
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("USER_BANNED");
	});

	it("403 for mod with unverified email", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(3, 0, 0) } });
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(403);
	});
});

// ─── Forum-scope gate ────────────────────────────────────────────

describe("PATCH /api/v1/forums/:id/announcement — forum scope", () => {
	it("200 for Admin on any forum", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthRow(1), ...mockUserRow(1, 1, "admin"), ...mockForumRow(1, "") },
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(
			patchRequest(1, token, { announcement: "<p>hello</p>" }),
			env,
		);
		expect(res.status).toBe(200);
	});

	it("200 for SuperMod on any forum", async () => {
		const token = await makeToken(2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(2),
				...mockUserRow(1, 2, "supermod"),
				...mockForumRow(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "" }), env);
		expect(res.status).toBe(200);
	});

	it("200 for Mod whose username is in forum.moderators", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockUserRow(2, 3, "moduser"),
				...mockForumRow(1, "moduser,othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "ok" }), env);
		expect(res.status).toBe(200);
	});

	it("403 for Mod NOT in forum.moderators", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockUserRow(2, 3, "moduser"),
				...mockForumRow(1, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("FORBIDDEN");
	});

	it("404 when forum does not exist", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockUserRow(1, 1, "admin"),
				// no mockForumRow → getForumForPermission returns null
			},
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(999, token, { announcement: "x" }), env);
		expect(res.status).toBe(404);
	});
});

// ─── Body validation ─────────────────────────────────────────────

describe("PATCH /api/v1/forums/:id/announcement — body validation", () => {
	it("400 INVALID_BODY when JSON is malformed", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/forums/1/announcement", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "{not json",
		});
		const res = await setAnnouncement(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("400 INVALID_BODY when announcement is not a string", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: 123 }), env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("400 PAYLOAD_TOO_LARGE when sanitized output exceeds 4 KiB", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const huge = "a".repeat(5000);
		const res = await setAnnouncement(patchRequest(1, token, { announcement: huge }), env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("PAYLOAD_TOO_LARGE");
	});

	it("400 INVALID_REQUEST when forum ID is non-numeric", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/forums/abc/announcement", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ announcement: "x" }),
		});
		const res = await setAnnouncement(req, env);
		expect(res.status).toBe(400);
	});
});

// ─── Sanitize + persist + invalidate ────────────────────────────

describe("PATCH /api/v1/forums/:id/announcement — sanitize + persist + invalidate", () => {
	it("strips <script>, persists sanitized HTML, returns updated forum", async () => {
		const token = await makeToken(1);
		const { db, calls } = createMockDb({
			firstResults: { ...mockAuthRow(1), ...mockUserRow(1, 1, "admin"), ...mockForumRow(1, "") },
		});
		const env = makeEnv({ DB: db });
		const payload = "<p>hi</p><script>alert(1)</script><p>bye</p>";
		const res = await setAnnouncement(patchRequest(1, token, { announcement: payload }), env);
		expect(res.status).toBe(200);

		const data = (await res.json()) as { data: { id: number; announcement: string } };
		expect(data.data.id).toBe(1);
		expect(data.data.announcement).toContain("<p>hi</p>");
		expect(data.data.announcement).toContain("<p>bye</p>");
		expect(data.data.announcement).not.toContain("script");
		expect(data.data.announcement).not.toContain("alert");

		// UPDATE called with sanitized HTML (not raw input)
		const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET announcement"));
		expect(updateCall).toBeDefined();
		expect(updateCall?.params[0]).not.toContain("<script");
		expect(updateCall?.params[0]).toContain("<p>hi</p>");
		expect(updateCall?.params[1]).toBe(1);
	});

	it("forces <a> rel/target hardening when persisting", async () => {
		const token = await makeToken(1);
		const { db, calls } = createMockDb({
			firstResults: { ...mockAuthRow(1), ...mockUserRow(1, 1, "admin"), ...mockForumRow(1, "") },
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(
			patchRequest(1, token, { announcement: '<a href="https://x.com">x</a>' }),
			env,
		);
		expect(res.status).toBe(200);
		const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET announcement"));
		expect(updateCall?.params[0]).toContain('rel="nofollow noopener"');
		expect(updateCall?.params[0]).toContain('target="_blank"');
	});

	it("empty announcement clears the column (persists empty string)", async () => {
		const token = await makeToken(1);
		const { db, calls } = createMockDb({
			firstResults: { ...mockAuthRow(1), ...mockUserRow(1, 1, "admin"), ...mockForumRow(1, "") },
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "" }), env);
		expect(res.status).toBe(200);
		const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET announcement"));
		expect(updateCall?.params[0]).toBe("");
	});

	it("bumps forum:tree:gen and forum:summary:gen (announcement update)", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthRow(1), ...mockUserRow(1, 1, "admin"), ...mockForumRow(1, "") },
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(200);

		// Two PUTs to the gen keys (KV-backed counters) — values do not
		// matter, only that the keys were touched, which forces caches
		// to fall back to D1 and rewrite under new gens.
		const puts = (kv.put as { mock: { calls: [string, string][] } }).mock.calls;
		const keys = puts.map(([k]) => k);
		expect(keys).toContain("forum:tree:gen");
		expect(keys).toContain("forum:summary:gen");
		// Digest gen NOT bumped — announcement is non-digest-affecting.
		expect(keys).not.toContain("digest:gen");
	});

	it("does NOT call UPDATE when permission check fails (no write side-effects)", async () => {
		const token = await makeToken(3, 2);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockUserRow(2, 3, "moduser"),
				...mockForumRow(1, "othermod"), // moduser NOT in moderators
			},
		});
		const env = makeEnv({ DB: db });
		const res = await setAnnouncement(patchRequest(1, token, { announcement: "x" }), env);
		expect(res.status).toBe(403);
		const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET announcement"));
		expect(updateCall).toBeUndefined();
	});
});
