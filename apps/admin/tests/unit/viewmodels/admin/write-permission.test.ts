import { describe, expect, it } from "vitest";
import type { User } from "@/viewmodels/admin/users";
import {
	evaluateWritePermission,
	registrationDays,
	userHasAvatar,
	type WritePermissionSettings,
} from "@/viewmodels/admin/write-permission";

// A single fixed "now" so registrationDays is deterministic across cases.
const NOW = 1_800_000_000; // arbitrary unix seconds
const DAY = 86_400;

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 42,
		username: "test",
		email: "test@example.com",
		avatar: "",
		avatarPath: "",
		hasAvatar: false,
		role: 0,
		status: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		coins: 0,
		regDate: NOW - 10 * DAY,
		lastLogin: 0,
		emailVerifiedAt: NOW - 5 * DAY, // verified
		emailNormalized: "test@example.com",
		emailChangedAt: 0,
		...overrides,
	};
}

const STRICT_SETTINGS: WritePermissionSettings = {
	allowNewThread: true,
	allowReply: true,
	postingRestrictionsEnabled: true,
	minRegistrationDays: 1,
	requireAvatar: true,
};

describe("write-permission", () => {
	describe("registrationDays", () => {
		it("returns 0 for missing / zero reg_date", () => {
			expect(registrationDays(0, NOW)).toBe(0);
		});

		it("returns 0 when reg_date is in the future (clock skew)", () => {
			expect(registrationDays(NOW + 10, NOW)).toBe(0);
		});

		it("floors the days delta same as the worker", () => {
			// 1.9 days should floor to 1, matching floor((now - reg) / 86400).
			expect(registrationDays(NOW - Math.floor(DAY * 1.9), NOW)).toBe(1);
			expect(registrationDays(NOW - 3 * DAY, NOW)).toBe(3);
		});
	});

	describe("userHasAvatar", () => {
		it("is true when avatarPath is set", () => {
			expect(userHasAvatar({ avatarPath: "avatars/a.jpg", hasAvatar: false })).toBe(true);
		});

		it("is true when has_avatar flag is set (legacy)", () => {
			expect(userHasAvatar({ avatarPath: "", hasAvatar: true })).toBe(true);
		});

		it("is false when neither is set", () => {
			expect(userHasAvatar({ avatarPath: "", hasAvatar: false })).toBe(false);
			expect(userHasAvatar({})).toBe(false);
		});
	});

	describe("evaluateWritePermission", () => {
		it("passes every layer for a fully-verified normal user with avatar", () => {
			const user = makeUser({ avatarPath: "avatars/x.jpg" });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			expect(result.canWrite).toBe(true);
			expect(result.blockedBy).toEqual([]);
			expect(result.items.map((i) => i.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
		});

		it("apple58 profile — unverified email + no avatar → both fail, remainder pass", () => {
			// The exact profile of the 14.112.46.130 batch: normal status, no email
			// verification, no avatar, past the min-reg-days threshold.
			const user = makeUser({
				emailVerifiedAt: 0,
				avatarPath: "",
				hasAvatar: false,
				regDate: NOW - 8 * DAY,
			});
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);

			expect(result.canWrite).toBe(false);
			expect(result.blockedBy).toEqual(["邮箱验证", "用户头像"]);

			const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
			expect(byId.L2.status).toBe("pass");
			expect(byId.L3.status).toBe("fail");
			expect(byId.L3.code).toBe("EMAIL_NOT_VERIFIED");
			expect(byId.L4.status).toBe("pass");
			expect(byId.L5.status).toBe("pass");
			expect(byId.L6.status).toBe("fail");
			expect(byId.L6.code).toBe("AVATAR_MISSING");
		});

		it("skips L3~L6 when status short-circuits at L2 (banned)", () => {
			const user = makeUser({ status: -1 });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			expect(result.items[0].code).toBe("STATUS_BANNED");
			expect(result.items.slice(1).every((i) => i.status === "skip")).toBe(true);
			// Only L2 counts against canWrite when status short-circuits; the
			// skipped items must not artificially inflate blockedBy.
			expect(result.blockedBy).toEqual(["账号状态"]);
		});

		it("tombstone (status=-99) surfaces distinct code and skip message", () => {
			const user = makeUser({ status: -99 });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			expect(result.items[0].code).toBe("STATUS_TOMBSTONE");
			expect(result.items[1].detail).toBe("账号已清除，后续检查跳过");
		});

		it("staff (role=1) bypass L4/L5/L6 but still respect L3", () => {
			const user = makeUser({ role: 1, emailVerifiedAt: 0 });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
			expect(byId.L3.status).toBe("fail"); // email gate still applies to staff
			expect(byId.L4.code).toBe("STAFF_BYPASS");
			expect(byId.L5.code).toBe("STAFF_BYPASS");
			expect(byId.L6.code).toBe("STAFF_BYPASS");
			expect(result.canWrite).toBe(false); // still blocked by L3
			expect(result.blockedBy).toEqual(["邮箱验证"]);
		});

		it("L5 reg_days short — reports the exact numbers", () => {
			// reg 1h ago, threshold 1 day → floor((3600) / 86400) = 0 days
			const user = makeUser({ regDate: NOW - 3600 });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			const l5 = result.items.find((i) => i.id === "L5");
			expect(l5?.status).toBe("fail");
			expect(l5?.code).toBe("REG_DAYS_TOO_SHORT");
			expect(l5?.detail).toBe("0 天 < 1 天");
		});

		it("posting master switch off → L5+L6 report info, no fail", () => {
			const user = makeUser({ avatarPath: "" });
			const settings: WritePermissionSettings = {
				...STRICT_SETTINGS,
				postingRestrictionsEnabled: false,
			};
			const result = evaluateWritePermission(user, settings, NOW);
			const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
			expect(byId.L5.code).toBe("POSTING_RESTRICTIONS_OFF");
			expect(byId.L5.status).toBe("info");
			expect(byId.L6.code).toBe("POSTING_RESTRICTIONS_OFF");
			expect(byId.L6.status).toBe("info");
			expect(result.canWrite).toBe(true);
		});

		it("both content switches off → L4 reports BOTH", () => {
			const settings: WritePermissionSettings = {
				...STRICT_SETTINGS,
				allowNewThread: false,
				allowReply: false,
			};
			const user = makeUser({ avatarPath: "avatars/a.jpg" });
			const result = evaluateWritePermission(user, settings, NOW);
			const l4 = result.items.find((i) => i.id === "L4");
			expect(l4?.status).toBe("fail");
			expect(l4?.code).toBe("CONTENT_DISABLED_BOTH");
		});

		it("only new-thread off → L4 reports THREAD variant", () => {
			const settings: WritePermissionSettings = {
				...STRICT_SETTINGS,
				allowNewThread: false,
			};
			const user = makeUser({ avatarPath: "avatars/a.jpg" });
			const result = evaluateWritePermission(user, settings, NOW);
			const l4 = result.items.find((i) => i.id === "L4");
			expect(l4?.code).toBe("CONTENT_DISABLED_THREAD");
		});

		it("only reply off → L4 reports REPLY variant", () => {
			const settings: WritePermissionSettings = {
				...STRICT_SETTINGS,
				allowReply: false,
			};
			const user = makeUser({ avatarPath: "avatars/a.jpg" });
			const result = evaluateWritePermission(user, settings, NOW);
			const l4 = result.items.find((i) => i.id === "L4");
			expect(l4?.code).toBe("CONTENT_DISABLED_REPLY");
		});

		it("require_avatar off but user has no avatar → L6 passes as NOT_REQUIRED", () => {
			const settings: WritePermissionSettings = {
				...STRICT_SETTINGS,
				requireAvatar: false,
			};
			const user = makeUser();
			const result = evaluateWritePermission(user, settings, NOW);
			const l6 = result.items.find((i) => i.id === "L6");
			expect(l6?.code).toBe("AVATAR_NOT_REQUIRED");
			expect(l6?.status).toBe("pass");
		});

		it("legacy avatar (has_avatar=true, empty avatarPath) passes L6", () => {
			const user = makeUser({ hasAvatar: true, avatarPath: "" });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			const l6 = result.items.find((i) => i.id === "L6");
			expect(l6?.code).toBe("AVATAR_PRESENT");
			expect(l6?.status).toBe("pass");
		});

		it("blockedBy preserves the natural top-down order (L3 before L6)", () => {
			const user = makeUser({ emailVerifiedAt: 0, avatarPath: "", hasAvatar: false });
			const result = evaluateWritePermission(user, STRICT_SETTINGS, NOW);
			expect(result.blockedBy).toEqual(["邮箱验证", "用户头像"]);
		});
	});
});
