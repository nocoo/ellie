// Tests for the ip-lookup viewmodel — Phase G.6.3.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from "@/lib/api-client";
import {
	type IpLookupNormalized,
	describeInvalidIpReason,
	formatIpLookupSummary,
	lookupIp,
} from "@/viewmodels/admin/ip-lookup";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

const FULL: IpLookupNormalized = {
	country: "Australia",
	countryIso2: "AU",
	region: "Queensland",
	city: "Brisbane",
	isp: "Cloudflare",
	asn: null,
	org: null,
};

describe("lookupIp", () => {
	it("GETs /api/admin/ip-lookup with ?ip and unwraps data", async () => {
		mockGet.mockResolvedValue({
			data: {
				ip: "1.1.1.1",
				cached: false,
				normalized: FULL,
				raw: { source: "echo" },
				rawTruncated: false,
				fetchedAt: 1_700_000_000,
			},
		});

		const result = await lookupIp("1.1.1.1");

		expect(mockGet).toHaveBeenCalledWith("/api/admin/ip-lookup", { ip: "1.1.1.1" });
		expect(result.ip).toBe("1.1.1.1");
		expect(result.cached).toBe(false);
		expect(result.normalized.countryIso2).toBe("AU");
		expect(result.rawTruncated).toBe(false);
	});

	it("passes the ip verbatim — does not trim or canonicalize", async () => {
		mockGet.mockResolvedValue({
			data: {
				ip: "  8.8.8.8  ",
				cached: true,
				normalized: { ...FULL, country: "US" },
				raw: {},
				rawTruncated: false,
				fetchedAt: 1,
			},
		});
		await lookupIp("  8.8.8.8  ");
		expect(mockGet).toHaveBeenCalledWith("/api/admin/ip-lookup", { ip: "  8.8.8.8  " });
	});
});

describe("formatIpLookupSummary", () => {
	it("joins city, region, country with isp suffix", () => {
		expect(formatIpLookupSummary(FULL)).toBe("Brisbane, Queensland, Australia (Cloudflare)");
	});

	it("drops null segments", () => {
		expect(
			formatIpLookupSummary({
				country: "United States",
				countryIso2: "US",
				region: null,
				city: null,
				isp: null,
				asn: null,
				org: null,
			}),
		).toBe("United States");
	});

	it("drops null head segments and keeps isp", () => {
		expect(
			formatIpLookupSummary({
				country: null,
				countryIso2: null,
				region: null,
				city: null,
				isp: "China Telecom",
				asn: null,
				org: null,
			}),
		).toBe("(China Telecom)");
	});

	it('returns "未知" when nothing is set', () => {
		expect(
			formatIpLookupSummary({
				country: null,
				countryIso2: null,
				region: null,
				city: null,
				isp: null,
				asn: null,
				org: null,
			}),
		).toBe("未知");
	});
});

describe("describeInvalidIpReason", () => {
	it.each([
		["missing", "未提供 IP"],
		["malformed", "IP 格式错误"],
		["private", "私网地址"],
		["reserved", "保留地址"],
		["upstream_invalid", "上游判定 IP 无效"],
	])("maps %s → %s", (input, label) => {
		expect(describeInvalidIpReason(input)).toBe(label);
	});

	it("falls back for unknown / undefined reasons", () => {
		expect(describeInvalidIpReason(undefined)).toBe("IP 无效");
		expect(describeInvalidIpReason("something_else")).toBe("IP 无效");
	});
});
