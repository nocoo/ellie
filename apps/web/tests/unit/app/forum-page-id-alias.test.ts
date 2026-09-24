import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	permanentRedirect: vi.fn((to: string) => {
		throw new Error(`NEXT_PERMANENT_REDIRECT:${to}`);
	}),
	parent: vi.fn(async () => "RENDERED_FORUM_PAGE"),
}));

vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
	permanentRedirect: mocks.permanentRedirect,
}));

// The alias imports `../page` (the bare `[id]/page.tsx`). Use the
// alias path so vitest resolves to the same canonical module ID.
vi.mock("@/app/(forum)/forums/[id]/page", () => ({
	default: mocks.parent,
}));

// Re-import alias after the mocks are in place.
import ForumThreadsPagedPage from "@/app/(forum)/forums/[id]/[page]/page";

function callAlias(
	id: string,
	page: string,
	sp: Record<string, string | string[] | undefined> = {},
) {
	return ForumThreadsPagedPage({
		params: Promise.resolve({ id, page }),
		searchParams: Promise.resolve(sp),
	});
}

describe("forums/[id]/[page]/page.tsx alias", () => {
	it("invalid page segment → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("306", "abc")).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("page=0 → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("306", "0")).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("leading-zero page (e.g. 01) → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("306", "01")).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(1);
	});

	it("negative page → notFound()", async () => {
		mocks.notFound.mockClear();
		await expect(callAlias("306", "-2")).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("page=1 → permanentRedirect to bare /forums/:id", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(callAlias("306", "1")).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/forums/306");
	});

	it("page=1 with typeId carries the typeId through redirect", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(callAlias("306", "1", { typeId: "11" })).rejects.toThrow(
			"NEXT_PERMANENT_REDIRECT:/forums/306?typeId=11",
		);
	});

	it("page=1 drops non-string / non-whitelisted query on redirect", async () => {
		mocks.permanentRedirect.mockClear();
		await expect(callAlias("306", "1", { typeId: ["a", "b"], evil: "1" })).rejects.toThrow(
			"NEXT_PERMANENT_REDIRECT:/forums/306",
		);
	});

	it.each(["2", "3", "5"])("page %s delegates using the trusted request context", async (page) => {
		mocks.parent.mockClear();
		const result = await callAlias("306", page, { typeId: "11", page: "999", evil: "drop-me" });
		expect(result).toBe("RENDERED_FORUM_PAGE");
		expect(mocks.parent).toHaveBeenCalledOnce();
		const arg = mocks.parent.mock.calls[0][0] as { params: Promise<{ id: string }> };
		await expect(arg.params).resolves.toEqual({ id: "306" });
		expect(arg).not.toHaveProperty("searchParams");
	});
	it("rejects a page beyond safe integer precision", async () => {
		await expect(callAlias("306", "9007199254740992")).rejects.toThrow("NEXT_NOT_FOUND");
	});
});
