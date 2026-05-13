// Tests for the ip-lookup viewmodel — Phase G.6.3.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from "@/lib/api-client";
import {
	type IpLookupNormalized,
	describeInvalidIpReason,
	describeIpLookupError,
	formatIpLookupSummary,
	lookupIp,
} from "@/viewmodels/admin/ip-lookup";
import { ApiError } from "@ellie/shared";

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

describe("describeIpLookupError", () => {
	it("maps INVALID_IP using details.reason", () => {
		const e = new ApiError(400, {
			code: "INVALID_IP",
			message: "x",
			details: { reason: "private" },
		});
		expect(describeIpLookupError(e)).toBe("私网地址");
	});

	it("maps INVALID_IP without reason to generic IP 无效", () => {
		const e = new ApiError(400, { code: "INVALID_IP", message: "x" });
		expect(describeIpLookupError(e)).toBe("IP 无效");
	});

	it.each([
		["IP_LOOKUP_NOT_CONFIGURED", "IP 查询服务未配置"],
		["IP_LOOKUP_TIMEOUT", "上游超时，请稍后重试"],
		["IP_LOOKUP_PARSE_FAILED", "上游响应解析失败"],
		["IP_LOOKUP_TRANSPORT_ERROR", "网络错误，请稍后重试"],
	])("maps %s → %s", (code, msg) => {
		expect(describeIpLookupError(new ApiError(500, code, "raw"))).toBe(msg);
	});

	it("maps IP_LOOKUP_UPSTREAM_<status> with status suffix", () => {
		expect(describeIpLookupError(new ApiError(502, "IP_LOOKUP_UPSTREAM_502", "x"))).toBe(
			"上游错误（502）",
		);
	});

	it("falls back to err.message for unknown ApiError code", () => {
		expect(describeIpLookupError(new ApiError(500, "WEIRD", "boom"))).toBe("boom");
	});

	it("uses Error.message for non-ApiError Errors", () => {
		expect(describeIpLookupError(new Error("network down"))).toBe("network down");
	});

	it("falls back to 查询失败 for non-Error values", () => {
		expect(describeIpLookupError("string")).toBe("查询失败");
		expect(describeIpLookupError(undefined)).toBe("查询失败");
	});
});
