// IpLookupInline component test — Phase G.6.4.1.
//
// Pins the panel's behavioural contract:
//   - Empty / blank IP renders nothing (no button, no fetch).
//   - Click → success: normalized summary + cache hint, raw inside a
//     `<details>` (default closed).
//   - `rawTruncated=true` swaps the raw block for the 8KB hint and
//     renders no `<details>` (we never expose truncated raw).
//   - `lookupIp` rejecting with `ApiError(INVALID_IP, reason=private)`
//     surfaces "私网地址" via `describeIpLookupError`.

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/viewmodels/admin/ip-lookup", async () => {
	const actual = await vi.importActual<typeof import("@/viewmodels/admin/ip-lookup")>(
		"@/viewmodels/admin/ip-lookup",
	);
	return { ...actual, lookupIp: vi.fn() };
});

import { ApiError } from "@ellie/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { type IpLookupResult, lookupIp } from "@/viewmodels/admin/ip-lookup";

const mockLookupIp = lookupIp as ReturnType<typeof vi.fn>;

const RESULT: IpLookupResult = {
	ip: "1.1.1.1",
	cached: true,
	normalized: {
		country: "Australia",
		countryIso2: "AU",
		region: "Queensland",
		city: "Brisbane",
		isp: "Cloudflare",
		asn: "AS13335",
		org: null,
	},
	raw: { country: "Australia", isp: "Cloudflare" },
	rawTruncated: false,
	fetchedAt: 1_700_000_000,
};

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe("IpLookupInline — empty / blank IP", () => {
	it("renders nothing when ip is undefined", () => {
		const { container } = render(<IpLookupInline ip={undefined} />);
		expect(container.firstChild).toBeNull();
		expect(mockLookupIp).not.toHaveBeenCalled();
	});

	it("renders nothing when ip is null", () => {
		const { container } = render(<IpLookupInline ip={null} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when ip is blank whitespace", () => {
		const { container } = render(<IpLookupInline ip="   " />);
		expect(container.firstChild).toBeNull();
	});
});

describe("IpLookupInline — query success", () => {
	it("on click renders normalized summary, cache hint, and collapsed raw <details>", async () => {
		mockLookupIp.mockResolvedValue(RESULT);
		render(<IpLookupInline ip="1.1.1.1" />);

		const btn = screen.getByRole("button", { name: "查询" });
		await act(async () => {
			fireEvent.click(btn);
		});

		await waitFor(() => {
			expect(screen.queryByText("Brisbane, Queensland, Australia (Cloudflare)")).not.toBeNull();
		});
		expect(mockLookupIp).toHaveBeenCalledWith("1.1.1.1");
		expect(screen.queryByText("已命中缓存")).not.toBeNull();

		// Raw block lives inside a <details> that defaults to closed.
		const details = screen.getByText("原始上游响应").closest("details");
		expect(details).not.toBeNull();
		expect((details as HTMLDetailsElement).open).toBe(false);

		// Button label flips to "重新查询" after a successful query.
		expect(screen.queryByRole("button", { name: "重新查询" })).not.toBeNull();
	});

	it("rawTruncated=true renders 8KB截断 hint and NO <details>", async () => {
		mockLookupIp.mockResolvedValue({ ...RESULT, rawTruncated: true });
		render(<IpLookupInline ip="2.2.2.2" />);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "查询" }));
		});

		await waitFor(() => {
			expect(screen.queryByText(/原始数据超过 8KB，已截断/)).not.toBeNull();
		});
		expect(screen.queryByText("原始上游响应")).toBeNull();
	});
});

describe("IpLookupInline — error mapping", () => {
	it("ApiError(INVALID_IP, reason=private) → '私网地址'", async () => {
		mockLookupIp.mockRejectedValue(
			new ApiError(400, {
				code: "INVALID_IP",
				message: "invalid",
				details: { reason: "private" },
			}),
		);
		render(<IpLookupInline ip="10.0.0.1" />);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "查询" }));
		});

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toContain("私网地址");
		});
		// No result panel rendered on error.
		expect(screen.queryByText("已命中缓存")).toBeNull();
		expect(screen.queryByText("原始上游响应")).toBeNull();
	});
});
