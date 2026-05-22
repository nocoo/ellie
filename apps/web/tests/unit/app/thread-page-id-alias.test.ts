// Unit tests for the path-segment pagination alias route
// `/threads/:id/:page/page.tsx`.
//
// Mirrors `forum-page-id-alias.test.ts` but with the thread-specific
// rule: `:page` segment is authoritative, so the alias DROPS
// `cursor` / `direction` / `last` on delegate (they cannot beat the
// segment-supplied page in the bare-id route's priority resolver).
// Only `returnTo` survives.

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	permanentRedirect: vi.fn((to: string) => {
		throw new Error(`NEXT_PERMANENT_REDIRECT:${to}`);
	}),
	parent: vi.fn(async () => "RENDERED_THREAD_PAGE"),
}));

vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
	permanentRedirect: mocks.permanentRedirect,
}));

vi.mock("@/app/(forum)/threads/[id]/page", () => ({
	default: mocks.parent,
}));

import ThreadDetailPagedPage from "@/app/(forum)/threads/[id]/[page]/page";

function callAlias(
	id: string,
	page: string,
	sp: Record<string, string | string[] | undefined> = {},
) {
	return ThreadDetailPagedPage({
		params: Promise.resolve({ id, page }),
		searchParams: Promise.resolve(sp),
	});
}

describe("threads/[id]/[page]/page.tsx alias", () => {
	it("invalid page segment → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("923066", "abc")).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("page=0 → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("923066", "0")).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("leading-zero page → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("923066", "02")).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("page=1 → permanentRedirect to bare /threads/:id", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(callAlias("923066", "1")).rejects.toThrow(
			"NEXT_PERMANENT_REDIRECT:/threads/923066",
		);
	});

	it("page=1 carries returnTo on redirect", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(callAlias("923066", "1", { returnTo: "/forums/306" })).rejects.toThrow(
			"NEXT_PERMANENT_REDIRECT:/threads/923066?returnTo=%2Fforums%2F306",
		);
	});

	it("page=1 drops cursor / direction / last on redirect (only returnTo passes)", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(
			callAlias("923066", "1", {
				cursor: "deadbeef",
				direction: "next",
				last: "1",
				evil: "1",
			}),
		).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/threads/923066");
	});

	it("page >= 2 → delegates to parent ThreadDetailPage with returnTo only + segment page", async () => {
		mocks.parent.mockClear();
		const result = await callAlias("923066", "3", {
			cursor: "abc",
			direction: "next",
			last: "0",
			returnTo: "/forums/306",
		});
		expect(result).toBe("RENDERED_THREAD_PAGE");
		expect(mocks.parent).toHaveBeenCalledTimes(1);
		const arg = mocks.parent.mock.calls[0][0] as {
			params: Promise<{ id: string }>;
			searchParams: Promise<Record<string, string>>;
		};
		await expect(arg.params).resolves.toEqual({ id: "923066" });
		// cursor / direction / last are dropped: `:page` is authoritative.
		await expect(arg.searchParams).resolves.toEqual({
			returnTo: "/forums/306",
			page: "3",
		});
	});

	it("page >= 2 drops cursor / direction / last so segment beats internal cursor", async () => {
		mocks.parent.mockClear();
		await callAlias("923066", "2", {
			cursor: "deadbeef",
			direction: "next",
			last: "1",
		});
		const arg = mocks.parent.mock.calls[0][0] as {
			searchParams: Promise<Record<string, string>>;
		};
		await expect(arg.searchParams).resolves.toEqual({ page: "2" });
	});

	it("page >= 2 drops unknown query (whitelist enforced)", async () => {
		mocks.parent.mockClear();
		await callAlias("923066", "2", { evil: "drop", typeId: "11" });
		const arg = mocks.parent.mock.calls[0][0] as {
			searchParams: Promise<Record<string, string>>;
		};
		await expect(arg.searchParams).resolves.toEqual({ page: "2" });
	});

	it("page >= 2 segment overrides caller-supplied page in searchParams", async () => {
		mocks.parent.mockClear();
		await callAlias("923066", "4", { page: "999" });
		const arg = mocks.parent.mock.calls[0][0] as {
			searchParams: Promise<Record<string, string>>;
		};
		await expect(arg.searchParams).resolves.toEqual({ page: "4" });
	});
});
