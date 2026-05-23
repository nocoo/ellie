import { UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { canViewModeratedThread } from "../../../src/lib/visibility";

describe("canViewModeratedThread", () => {
	const authorId = 100;
	const forumModeratorIds = "200,201";

	it("returns false for anonymous (null user)", () => {
		expect(canViewModeratedThread({ authorId, forumModeratorIds, user: null })).toBe(false);
	});

	it("returns true for the thread author", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 100, role: UserRole.User },
			}),
		).toBe(true);
	});

	it("returns false for a non-author regular user", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 999, role: UserRole.User },
			}),
		).toBe(false);
	});

	it("returns true for Admin regardless of author/moderator", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 500, role: UserRole.Admin },
			}),
		).toBe(true);
	});

	it("returns true for SuperMod regardless of author/moderator", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 500, role: UserRole.SuperMod },
			}),
		).toBe(true);
	});

	it("returns true for Mod whose ID is in forumModeratorIds", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 200, role: UserRole.Mod },
			}),
		).toBe(true);
	});

	it("returns false for Mod whose ID is NOT in forumModeratorIds", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds,
				user: { userId: 300, role: UserRole.Mod },
			}),
		).toBe(false);
	});

	it("handles empty forumModeratorIds string", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds: "",
				user: { userId: 200, role: UserRole.Mod },
			}),
		).toBe(false);
	});

	it("handles whitespace in forumModeratorIds", () => {
		expect(
			canViewModeratedThread({
				authorId,
				forumModeratorIds: " 200 , 201 ",
				user: { userId: 200, role: UserRole.Mod },
			}),
		).toBe(true);
	});
});
