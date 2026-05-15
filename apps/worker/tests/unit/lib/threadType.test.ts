// Tests for the shared resolveAndValidateTypeId helper used by both
// GET /api/v1/threads (filter) and POST /api/v1/threads (create).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { coerceTypeIdInput, resolveAndValidateTypeId } from "../../../src/lib/threadType";
import { makeEnv } from "../../helpers";

function envWith(rowResult: unknown) {
	const first = vi.fn().mockResolvedValue(rowResult);
	const bind = vi.fn().mockReturnValue({ first });
	const prepare = vi.fn().mockReturnValue({ bind });
	const env = makeEnv({ DB: { prepare } as unknown as D1Database });
	return { env, prepare, bind, first };
}

describe("threadType — coerceTypeIdInput", () => {
	it("absent for null/undefined/empty string", () => {
		expect(coerceTypeIdInput(undefined)).toEqual({ kind: "absent" });
		expect(coerceTypeIdInput(null)).toEqual({ kind: "absent" });
		expect(coerceTypeIdInput("")).toEqual({ kind: "absent" });
	});
	it("ok for non-negative integers (string or number)", () => {
		expect(coerceTypeIdInput("0")).toEqual({ kind: "ok", value: 0 });
		expect(coerceTypeIdInput("42")).toEqual({ kind: "ok", value: 42 });
		expect(coerceTypeIdInput(7)).toEqual({ kind: "ok", value: 7 });
	});
	it("invalid for negative / non-integer / NaN", () => {
		expect(coerceTypeIdInput("-1").kind).toBe("invalid");
		expect(coerceTypeIdInput("abc").kind).toBe("invalid");
		expect(coerceTypeIdInput(1.5).kind).toBe("invalid");
		expect(coerceTypeIdInput(Number.NaN).kind).toBe("invalid");
	});
	it("strict string parsing — rejects partial/garbage suffixes (reviewer pin msg b4221d27)", () => {
		// `Number.parseInt` would silently accept these as 1 / 1 / 0 / 1.
		// We want a hard 400 instead — otherwise a typo in the URL would
		// resolve to category 1 in both the list filter AND the create path.
		expect(coerceTypeIdInput("1abc").kind).toBe("invalid");
		expect(coerceTypeIdInput("1.5").kind).toBe("invalid");
		expect(coerceTypeIdInput("01").kind).toBe("invalid"); // leading zero
		expect(coerceTypeIdInput("0x1").kind).toBe("invalid");
		expect(coerceTypeIdInput("+1").kind).toBe("invalid");
		expect(coerceTypeIdInput(" 1").kind).toBe("invalid"); // leading space
		expect(coerceTypeIdInput("1 ").kind).toBe("invalid"); // trailing space
		expect(coerceTypeIdInput("1\n").kind).toBe("invalid");
	});
	it("invalid for non-string / non-number values", () => {
		expect(coerceTypeIdInput({}).kind).toBe("invalid");
		expect(coerceTypeIdInput([]).kind).toBe("invalid");
		expect(coerceTypeIdInput([1]).kind).toBe("invalid");
		expect(coerceTypeIdInput(true).kind).toBe("invalid");
		expect(coerceTypeIdInput(false).kind).toBe("invalid");
	});
	it("invalid for non-finite numbers", () => {
		expect(coerceTypeIdInput(Number.POSITIVE_INFINITY).kind).toBe("invalid");
		expect(coerceTypeIdInput(Number.NEGATIVE_INFINITY).kind).toBe("invalid");
	});
});

describe("threadType — resolveAndValidateTypeId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("noTypeRequested when typeId is null / undefined / 0 (no D1 hit)", async () => {
		const { env, prepare } = envWith(null);
		expect((await resolveAndValidateTypeId(env, 5, null, { enabled: true })).kind).toBe(
			"noTypeRequested",
		);
		expect((await resolveAndValidateTypeId(env, 5, undefined, { enabled: true })).kind).toBe(
			"noTypeRequested",
		);
		expect((await resolveAndValidateTypeId(env, 5, 0, { enabled: true })).kind).toBe(
			"noTypeRequested",
		);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("invalid:missingForumId when typeId !== 0 but forumId is null", async () => {
		const { env, prepare } = envWith(null);
		const r = await resolveAndValidateTypeId(env, null, 11, { enabled: true });
		expect(r).toEqual({
			kind: "invalid",
			reason: "missingForumId",
			message: "typeId requires forumId",
		});
		expect(prepare).not.toHaveBeenCalled();
	});

	it("invalid:forumDisabled when forum thread_types_enabled = 0", async () => {
		const { env, prepare } = envWith(null);
		const r = await resolveAndValidateTypeId(env, 5, 11, { enabled: false });
		expect(r.kind).toBe("invalid");
		if (r.kind === "invalid") {
			expect(r.reason).toBe("forumDisabled");
		}
		expect(prepare).not.toHaveBeenCalled();
	});

	it("invalid:notFound when row missing (no enabled row in this forum)", async () => {
		const { env } = envWith(null);
		const r = await resolveAndValidateTypeId(env, 5, 11, { enabled: true });
		expect(r.kind).toBe("invalid");
		if (r.kind === "invalid") {
			expect(r.reason).toBe("notFound");
		}
	});

	it("ok when (forumId, typeId) matches an enabled row; row.id/forumId/name surfaced", async () => {
		const { env, prepare, bind } = envWith({
			id: 11,
			forum_id: 5,
			name: "Question",
		});
		const r = await resolveAndValidateTypeId(env, 5, 11, { enabled: true });
		expect(r).toEqual({
			kind: "ok",
			row: { id: 11, forumId: 5, name: "Question" },
		});
		// SQL pin: hard-bind both forum_id AND id; require enabled = 1
		// (tombstones excluded). Order of bind args: typeId, forumId.
		const sql = (prepare.mock.calls[0]?.[0] ?? "") as string;
		expect(sql).toMatch(/WHERE\s+id\s*=\s*\?\s+AND\s+forum_id\s*=\s*\?\s+AND\s+enabled\s*=\s*1/i);
		expect(bind).toHaveBeenCalledWith(11, 5);
	});

	it("cross-forum typeId is treated as notFound (synthetic id from forum A doesn't satisfy forum B)", async () => {
		// Simulate: id 11 exists, but lives in forum 99. The query
		// constrains forum_id, so the lookup returns null.
		const { env } = envWith(null);
		const r = await resolveAndValidateTypeId(env, 5, 11, { enabled: true });
		expect(r.kind).toBe("invalid");
		if (r.kind === "invalid") {
			expect(r.reason).toBe("notFound");
		}
	});
});
