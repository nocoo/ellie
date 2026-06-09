import { describe, expect, it } from "vitest";
import { buildUserSearchParams, roleLabel, statusLabel } from "@/viewmodels/admin/users";

describe("users", () => {
	describe("buildUserSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildUserSearchParams({ page: 2, limit: 10 });
			expect(params.page).toBe(2);
			expect(params.limit).toBe(10);
		});

		it("includes username when set", () => {
			const params = buildUserSearchParams({ username: "john" });
			expect(params.username).toBe("john");
		});

		it("omits empty string username", () => {
			const params = buildUserSearchParams({ username: "" });
			expect(params.username).toBeUndefined();
		});

		it("omits null status and role", () => {
			const params = buildUserSearchParams({ status: null, role: null });
			expect(params.status).toBeUndefined();
			expect(params.role).toBeUndefined();
		});

		it("includes status when set", () => {
			const params = buildUserSearchParams({ status: -1 });
			expect(params.status).toBe(-1);
		});

		it("includes regIp / lastIp when set", () => {
			const params = buildUserSearchParams({ regIp: "1.2.3.4", lastIp: "5.6.7.8" });
			expect(params.regIp).toBe("1.2.3.4");
			expect(params.lastIp).toBe("5.6.7.8");
		});

		it("omits empty IP strings", () => {
			const params = buildUserSearchParams({ regIp: "", lastIp: "" });
			expect(params.regIp).toBeUndefined();
			expect(params.lastIp).toBeUndefined();
		});
	});

	describe("roleLabel", () => {
		it("returns 管理员 for 1", () => {
			expect(roleLabel(1)).toBe("管理员");
		});

		it("returns 超级版主 for 2", () => {
			expect(roleLabel(2)).toBe("超级版主");
		});

		it("returns 版主 for 3", () => {
			expect(roleLabel(3)).toBe("版主");
		});

		it("returns 会员 for other values", () => {
			expect(roleLabel(0)).toBe("会员");
			expect(roleLabel(99)).toBe("会员");
		});
	});

	describe("statusLabel", () => {
		it("returns 已封禁 for -1", () => {
			expect(statusLabel(-1)).toBe("已封禁");
		});

		it("returns 已归档 for -2", () => {
			expect(statusLabel(-2)).toBe("已归档");
		});

		it("returns 已清除 for -99 (D4 tombstone)", () => {
			expect(statusLabel(-99)).toBe("已清除");
		});

		it("returns 正常 for other values", () => {
			expect(statusLabel(0)).toBe("正常");
			expect(statusLabel(1)).toBe("正常");
		});
	});
});
