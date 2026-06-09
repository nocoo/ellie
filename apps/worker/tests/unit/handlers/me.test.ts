import { describe, expect, it } from "vitest";
import { changePassword, updateProfile } from "../../../src/handlers/me";
import type { Env } from "../../../src/lib/env";
import { hashPassword } from "../../../src/lib/password";
import {
	createJwtForRole,
	createMockDb,
	createMockKV,
	makeD1UserRow,
	TEST_JWT_SECRET,
} from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

describe("user self-service handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};

	describe("updateProfile", () => {
		it("should require authentication", async () => {
			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", { method: "PATCH" }),
				mockEnv,
			);

			expect(response.status).toBe(401);
		});

		it("should update email", async () => {
			// Email is no longer editable via PATCH /users/me — the dedicated
			// email verification endpoint owns that mutation. Profile PATCH
			// must reject any body that carries `email`, even when the user
			// is already verified.
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ email: "new@example.com" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("EMAIL_NOT_EDITABLE_HERE");
		});

		it("rejects an explicit email field even when paired with other fields", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ email: "x@y.com", bio: "hi" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("EMAIL_NOT_EDITABLE_HERE");
		});

		it("should update campus and signature (newly added profile fields)", async () => {
			const token = await createJwtForRole(0, 42);
			const updatedUser = makeD1UserRow({
				id: 42,
				campus: "四平路校区",
				signature: "Hello world",
			});
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, username, email": updatedUser,
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ campus: "四平路校区", signature: "Hello world" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.campus).toBe("四平路校区");
			expect(body.data.signature).toBe("Hello world");
		});

		it("should update avatar", async () => {
			const token = await createJwtForRole(0, 42);
			const updatedUser = makeD1UserRow({ id: 42, avatar: "new-avatar.png" });
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, username, email": updatedUser,
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ avatar: "new-avatar.png" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.avatar).toBe("new-avatar.png");
		});

		it("should require at least one field", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject invalid email format (still rejected as EMAIL_NOT_EDITABLE_HERE before validator runs)", async () => {
			// The email-not-editable guard runs before the validator, so even
			// a clearly invalid email surfaces as EMAIL_NOT_EDITABLE_HERE here.
			// Email format validation still lives in `validateProfileFields`
			// and is exercised through the registration path.
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ email: "not-an-email" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("EMAIL_NOT_EDITABLE_HERE");
		});

		it("should reject empty email (also caught by the not-editable guard)", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ email: "   " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("EMAIL_NOT_EDITABLE_HERE");
		});

		it("should handle malformed JSON", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should return 404 if user deleted after auth (race condition)", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, username, email": null, // user vanished between auth and SELECT
				},
			});

			const response = await updateProfile(
				new Request("https://example.com/api/v1/users/me", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ bio: "still here" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("USER_NOT_FOUND");
		});
	});

	describe("changePassword", () => {
		it("should require authentication", async () => {
			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", { method: "POST" }),
				mockEnv,
			);

			expect(response.status).toBe(401);
		});

		it("should require oldPassword and newPassword", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ oldPassword: "old" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("oldPassword and newPassword are required");
		});

		it("should reject short newPassword", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ oldPassword: "old", newPassword: "12345" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("newPassword must be at least 6 characters");
		});

		it("should reject wrong current password", async () => {
			const token = await createJwtForRole(0, 42);
			const storedHash = await hashPassword("correct_password");
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT password_hash": { password_hash: storedHash, password_salt: "" },
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ oldPassword: "wrong_password", newPassword: "new_password_123" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(401);
			const body = await response.json();
			expect(body.error.code).toBe("WRONG_PASSWORD");
		});

		it("should change password with correct old password (PBKDF2)", async () => {
			const token = await createJwtForRole(0, 42);
			const storedHash = await hashPassword("old_password");
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT password_hash": { password_hash: storedHash, password_salt: "" },
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ oldPassword: "old_password", newPassword: "new_password_123" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.updated).toBe(true);

			// Verify UPDATE was called
			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET password_hash"));
			expect(updateCall).toBeDefined();
		});

		it("should handle malformed JSON", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should return 404 if user record missing (race condition)", async () => {
			const token = await createJwtForRole(0, 42);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT password_hash": null, // user vanished between auth and SELECT
				},
			});

			const response = await changePassword(
				new Request("https://example.com/api/v1/users/me/password", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ oldPassword: "old_pass", newPassword: "new_pass_123" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("USER_NOT_FOUND");
		});
	});
});

describe("me handlers — §5.4 email-verification gate", () => {
	it("updateProfile: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await updateProfile(
			new Request("https://example.com/api/v1/me", {
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ nickname: "x" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("changePassword: unverified user is allowed through gate (allow-list — §5.1)", async () => {
		// changePassword stays on withAuthVerified per §5.1 allow-list. An unverified
		// user MUST NOT receive the §5.4 EmailNotVerifiedPayload here.
		const { env } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await changePassword(
			new Request("https://example.com/api/v1/me/password", {
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ oldPassword: "x", newPassword: "y" }),
			}),
			env,
		);
		const text = await response.clone().text();
		expect(text).not.toContain("EMAIL_NOT_VERIFIED");
	});
});
