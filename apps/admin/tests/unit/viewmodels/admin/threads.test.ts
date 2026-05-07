import { buildThreadSearchParams, digestLabel, stickyLabel } from "@/viewmodels/admin/threads";
import { describe, expect, it } from "vitest";

describe("threads", () => {
	describe("buildThreadSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildThreadSearchParams({ page: 1, limit: 20 });
			expect(params.page).toBe(1);
			expect(params.limit).toBe(20);
		});

		it("includes forumId when set", () => {
			const params = buildThreadSearchParams({ forumId: 5 });
			expect(params.forumId).toBe(5);
		});

		it("omits undefined forumId", () => {
			const params = buildThreadSearchParams({});
			expect(params.forumId).toBeUndefined();
		});

		it("omits empty authorName", () => {
			const params = buildThreadSearchParams({ authorName: "" });
			expect(params.authorName).toBeUndefined();
		});

		it("includes subject when provided", () => {
			const params = buildThreadSearchParams({ subject: "hello" });
			expect(params.subject).toBe("hello");
		});

		it('emits highlighted="1" for true and the number 1', () => {
			expect(buildThreadSearchParams({ highlighted: true }).highlighted).toBe("1");
			expect(buildThreadSearchParams({ highlighted: 1 }).highlighted).toBe("1");
		});

		it('emits highlighted="0" for false and the number 0 (so api-client doesn\'t drop it)', () => {
			expect(buildThreadSearchParams({ highlighted: false }).highlighted).toBe("0");
			expect(buildThreadSearchParams({ highlighted: 0 }).highlighted).toBe("0");
		});

		it("omits highlighted when undefined", () => {
			expect(buildThreadSearchParams({}).highlighted).toBeUndefined();
		});
	});

	describe("stickyLabel", () => {
		it("returns 版块置顶 for 1", () => {
			expect(stickyLabel(1)).toBe("版块置顶");
		});

		it("returns 全局置顶 for 2", () => {
			expect(stickyLabel(2)).toBe("全局置顶");
		});

		it("returns 分类置顶 for 3", () => {
			expect(stickyLabel(3)).toBe("分类置顶");
		});

		it("returns empty for 0 or other", () => {
			expect(stickyLabel(0)).toBe("");
			expect(stickyLabel(99)).toBe("");
		});
	});

	describe("digestLabel", () => {
		it("returns 精华 I for 1", () => {
			expect(digestLabel(1)).toBe("精华 I");
		});

		it("returns 精华 II for 2", () => {
			expect(digestLabel(2)).toBe("精华 II");
		});

		it("returns 精华 III for 3", () => {
			expect(digestLabel(3)).toBe("精华 III");
		});

		it("returns empty for 0 or other", () => {
			expect(digestLabel(0)).toBe("");
			expect(digestLabel(99)).toBe("");
		});
	});
});
