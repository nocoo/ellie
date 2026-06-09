// Tests for forum-self loader (apps/web/src/lib/forum-self.ts).
//
// The loader is the single seam that turns the Worker's SelfUser response
// into the narrow projection the /me page (and EmailVerificationCard)
// needs. We pin three things:
//   1. `projectSelfForumUser` keeps only the four fields we expose.
//   2. `toEmailVerificationUserView` strips down further to the card prop.
//   3. `getSelfForumUser` returns null for every failure mode (no JWT,
//      ForumApiError, generic throw), so the page can use null as the
//      "redirect to login" signal.

import type { User } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import {
	getSelfForumUser,
	projectSelfForumUser,
	toEmailVerificationUserView,
} from "@/lib/forum-self";

vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: vi.fn() }));
vi.mock("@/lib/forum-api", () => ({
	forumApi: { getAuth: vi.fn() },
	ForumApiError: class ForumApiError extends Error {
		status: number;
		code: string;
		constructor(status: number, body: { code: string; message: string }) {
			super(body.message);
			this.status = status;
			this.code = body.code;
		}
	},
}));

const mockGetWorkerJwt = getWorkerJwt as ReturnType<typeof vi.fn>;
const mockGetAuth = forumApi.getAuth as ReturnType<typeof vi.fn>;

// Build a SelfUser-shaped fixture with the fields the loader cares about.
// We don't fill every field — `projectSelfForumUser` should ignore them.
function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 42,
		username: "alice",
		email: "alice@example.com",
		avatar: "",
		avatarPath: "",
		status: 0,
		role: 0,
		regDate: 0,
		lastLogin: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		signature: "",
		groupTitle: "",
		groupStars: 0,
		groupColor: "",
		customTitle: "",
		digestPosts: 0,
		olTime: 0,
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		lastActivity: 0,
		emailVerifiedAt: 0,
		emailNormalized: "",
		emailChangedAt: 0,
		...overrides,
	};
}

describe("projectSelfForumUser — narrow projection", () => {
	it("keeps only id, username, email, emailVerifiedAt, emailChangedAt, role, status", () => {
		const u = makeUser({
			id: 7,
			username: "bob",
			email: "bob@example.com",
			emailVerifiedAt: 1700000000,
			emailChangedAt: 1699999999,
			role: 2,
			status: 0,
			// Noise fields that must NOT leak through.
			signature: "leak",
			credits: 999,
			regIp: "1.2.3.4",
		});
		expect(projectSelfForumUser(u)).toEqual({
			id: 7,
			username: "bob",
			email: "bob@example.com",
			emailVerifiedAt: 1700000000,
			emailChangedAt: 1699999999,
			role: 2,
			status: 0,
		});
	});

	it("forwards role / status for forum-scope permission checks", () => {
		// canModerate() needs both fields — Admin / SuperMod gate purely on
		// role, but the Mod path also requires status to be active before
		// the moderators-CSV check fires. Pin that the projection forwards
		// them verbatim so canEditAnnouncement on the forum page stays accurate.
		const admin = projectSelfForumUser(makeUser({ role: 3, status: 0 }));
		expect(admin.role).toBe(3);
		expect(admin.status).toBe(0);
		const banned = projectSelfForumUser(makeUser({ role: 2, status: 1 }));
		expect(banned.role).toBe(2);
		expect(banned.status).toBe(1);
	});

	it("preserves emailVerifiedAt=0 sentinel for unverified users", () => {
		const u = makeUser({ emailVerifiedAt: 0 });
		expect(projectSelfForumUser(u).emailVerifiedAt).toBe(0);
	});

	it("preserves empty email for unbound users", () => {
		const u = makeUser({ email: "", emailVerifiedAt: 0 });
		expect(projectSelfForumUser(u).email).toBe("");
	});

	it("preserves emailChangedAt=0 sentinel for never-corrected users", () => {
		const u = makeUser({ emailChangedAt: 0 });
		expect(projectSelfForumUser(u).emailChangedAt).toBe(0);
	});
});

describe("toEmailVerificationUserView", () => {
	it("strips id and username, keeps card-relevant fields", () => {
		const view = toEmailVerificationUserView({
			id: 7,
			username: "bob",
			email: "bob@example.com",
			emailVerifiedAt: 1700000000,
			emailChangedAt: 0,
		});
		expect(view).toEqual({
			email: "bob@example.com",
			emailVerifiedAt: 1700000000,
			emailChangedAt: 0,
		});
		// Sanity — should not have id/username.
		expect(view).not.toHaveProperty("id");
		expect(view).not.toHaveProperty("username");
	});

	it("forwards emailChangedAt so the card can hide the correction affordance", () => {
		const view = toEmailVerificationUserView({
			id: 7,
			username: "bob",
			email: "bob@example.com",
			emailVerifiedAt: 0,
			emailChangedAt: 1700000000,
		});
		expect(view.emailChangedAt).toBe(1700000000);
	});
});

describe("getSelfForumUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when there is no Worker JWT (not logged in)", async () => {
		mockGetWorkerJwt.mockResolvedValue(null);
		expect(await getSelfForumUser()).toBe(null);
		expect(mockGetAuth).not.toHaveBeenCalled();
	});

	it("returns the projected SelfForumUser on success", async () => {
		mockGetWorkerJwt.mockResolvedValue("jwt-abc");
		mockGetAuth.mockResolvedValue({
			data: makeUser({
				id: 99,
				username: "carol",
				email: "c@x.io",
				emailVerifiedAt: 123,
				role: 1,
				status: 0,
			}),
			meta: {},
		});
		expect(await getSelfForumUser()).toEqual({
			id: 99,
			username: "carol",
			email: "c@x.io",
			emailVerifiedAt: 123,
			emailChangedAt: 0,
			role: 1,
			status: 0,
		});
		expect(mockGetAuth).toHaveBeenCalledWith("/api/v1/auth/me", "jwt-abc");
	});

	it("returns null when the Worker returns a ForumApiError (e.g. USER_NOT_FOUND)", async () => {
		mockGetWorkerJwt.mockResolvedValue("jwt-abc");
		mockGetAuth.mockRejectedValue(
			new ForumApiError(404, { code: "USER_NOT_FOUND", message: "no such user" }),
		);
		expect(await getSelfForumUser()).toBe(null);
	});

	it("returns null when the Worker call throws a generic error (network/5xx)", async () => {
		mockGetWorkerJwt.mockResolvedValue("jwt-abc");
		mockGetAuth.mockRejectedValue(new Error("ECONNRESET"));
		expect(await getSelfForumUser()).toBe(null);
	});

	it("returns null when getWorkerJwt itself throws (e.g. missing AUTH_SECRET / corrupt cookie)", async () => {
		// Reviewer hardening (msg dd5aee78): getWorkerJwt() goes through
		// headers() / getToken() / AUTH_SECRET — all of which can throw.
		// The loader contract says "any failure → null"; verify the catch
		// covers the JWT-decrypt path too, not just the Worker call.
		mockGetWorkerJwt.mockRejectedValue(new Error("AUTH_SECRET environment variable is not set"));
		expect(await getSelfForumUser()).toBe(null);
		expect(mockGetAuth).not.toHaveBeenCalled();
	});
});
