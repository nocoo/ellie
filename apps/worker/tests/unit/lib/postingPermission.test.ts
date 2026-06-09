import { describe, expect, it } from "vitest";
import type { PostingUser } from "../../../src/lib/postingPermission";
import { checkPostingPermission } from "../../../src/lib/postingPermission";
import { createMockDb, makeEnv } from "../../helpers";

function makeUser(role = 0, userId = 1): PostingUser {
	return { userId, role };
}

function makeUserRow(overrides?: Record<string, unknown>) {
	return {
		status: 0,
		avatar_path: "",
		has_avatar: 0,
		reg_date: Math.floor(Date.now() / 1000) - 86400 * 30, // 30 days ago
		role: 0,
		...overrides,
	};
}

function makeSettingsRows(overrides?: Record<string, string>) {
	const defaults: Record<string, string> = {
		"features.posting.enabled": "false",
		"features.content.allow_new_thread": "true",
		"features.content.allow_reply": "true",
	};
	const merged = { ...defaults, ...overrides };
	return Object.entries(merged).map(([key, value]) => ({ key, value }));
}

function buildEnv(userRow: unknown, settingsRows: unknown[]) {
	const { db } = createMockDb({
		firstResults: {
			"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": userRow,
		},
		allResults: {
			"SELECT key, value FROM settings": settingsRows,
		},
	});
	return makeEnv({ DB: db });
}

describe("checkPostingPermission", () => {
	it("allows normal user with no restrictions", async () => {
		const env = buildEnv(makeUserRow(), makeSettingsRows());
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(true);
	});

	it("rejects user not found", async () => {
		const { db } = createMockDb(); // returns null for all first() calls
		const env = makeEnv({ DB: db });
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.status).toBe(404);
		}
	});

	it("rejects banned user (status=-1)", async () => {
		const env = buildEnv(makeUserRow({ status: -1 }), makeSettingsRows());
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.status).toBe(403);
		}
	});

	it("rejects muted user (status=-2)", async () => {
		const env = buildEnv(makeUserRow({ status: -2 }), makeSettingsRows());
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.error.status).toBe(403);
		}
	});

	// ─── Global content switches ───────────────────────────

	it("rejects thread creation when allow_new_thread is disabled", async () => {
		const env = buildEnv(
			makeUserRow(),
			makeSettingsRows({ "features.content.allow_new_thread": "false" }),
		);
		const result = await checkPostingPermission(env, makeUser(), undefined, "thread");
		expect(result.allowed).toBe(false);
	});

	it("rejects reply when allow_reply is disabled", async () => {
		const env = buildEnv(
			makeUserRow(),
			makeSettingsRows({ "features.content.allow_reply": "false" }),
		);
		const result = await checkPostingPermission(env, makeUser(), undefined, "reply");
		expect(result.allowed).toBe(false);
	});

	it("staff bypasses content switches", async () => {
		const env = buildEnv(
			makeUserRow({ role: 1 }),
			makeSettingsRows({
				"features.content.allow_new_thread": "false",
				"features.content.allow_reply": "false",
			}),
		);
		const result = await checkPostingPermission(env, makeUser(1), undefined, "thread");
		expect(result.allowed).toBe(true);
	});

	// ─── Posting restrictions ──────────────────────────────

	it("rejects user with insufficient registration days", async () => {
		const env = buildEnv(
			makeUserRow({ reg_date: Math.floor(Date.now() / 1000) - 86400 }), // 1 day ago
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.min_registration_days": "7",
			}),
		);
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(false);
	});

	it("allows user with enough registration days", async () => {
		const env = buildEnv(
			makeUserRow({ reg_date: Math.floor(Date.now() / 1000) - 86400 * 30 }),
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.min_registration_days": "7",
			}),
		);
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(true);
	});

	it("rejects user without avatar when required", async () => {
		const env = buildEnv(
			makeUserRow({ avatar_path: "", has_avatar: 0 }),
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.require_avatar": "true",
			}),
		);
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(false);
	});

	it("allows user with avatar_path when avatar required", async () => {
		const env = buildEnv(
			makeUserRow({ avatar_path: "some-guid.jpg" }),
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.require_avatar": "true",
			}),
		);
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(true);
	});

	it("allows user with legacy has_avatar=1 when avatar required", async () => {
		const env = buildEnv(
			makeUserRow({ avatar_path: "", has_avatar: 1 }),
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.require_avatar": "true",
			}),
		);
		const result = await checkPostingPermission(env, makeUser());
		expect(result.allowed).toBe(true);
	});

	it("staff bypasses posting restrictions", async () => {
		const env = buildEnv(
			makeUserRow({
				role: 1,
				reg_date: Math.floor(Date.now() / 1000),
				avatar_path: "",
				has_avatar: 0,
			}),
			makeSettingsRows({
				"features.posting.enabled": "true",
				"features.posting.min_registration_days": "30",
				"features.posting.require_avatar": "true",
			}),
		);
		const result = await checkPostingPermission(env, makeUser(1));
		expect(result.allowed).toBe(true);
	});

	it("message content type is allowed when no restrictions", async () => {
		const env = buildEnv(makeUserRow(), makeSettingsRows());
		const result = await checkPostingPermission(env, makeUser(), undefined, "message");
		expect(result.allowed).toBe(true);
	});
});
