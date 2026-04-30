import { buildIpBanSearchParams, formatExpiry } from "@/viewmodels/admin/ip-bans";
import { describe, expect, it } from "vitest";

describe("ip-bans", () => {
	describe("buildIpBanSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildIpBanSearchParams({ page: 1, limit: 20 });
			expect(params.page).toBe(1);
			expect(params.limit).toBe(20);
		});

		it("includes ip when set", () => {
			const params = buildIpBanSearchParams({ ip: "192.168.1.1" });
			expect(params.ip).toBe("192.168.1.1");
		});

		it("omits empty ip", () => {
			const params = buildIpBanSearchParams({ ip: "" });
			expect(params.ip).toBeUndefined();
		});

		it("includes expired boolean", () => {
			const params = buildIpBanSearchParams({ expired: true });
			expect(params.expired).toBe(true);
		});

		it("omits undefined expired", () => {
			const params = buildIpBanSearchParams({});
			expect(params.expired).toBeUndefined();
		});
	});

	describe("formatExpiry", () => {
		it("returns 永不过期 for null", () => {
			expect(formatExpiry(null)).toBe("永不过期");
		});

		it("returns 永不过期 for 0", () => {
			expect(formatExpiry(0)).toBe("永不过期");
		});

		it("returns formatted date for timestamp", () => {
			// 1704067200 = 2024-01-01 00:00:00 UTC
			const result = formatExpiry(1704067200);
			expect(result).toBeTruthy();
			expect(result).not.toBe("永不过期");
		});
	});
});
