import { describe, expect, it } from "vitest";
import { buildPostSearchParams } from "@/viewmodels/admin/posts";

describe("posts", () => {
	describe("buildPostSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildPostSearchParams({ page: 1, limit: 20 });
			expect(params.page).toBe(1);
			expect(params.limit).toBe(20);
		});

		it("includes threadId when set", () => {
			const params = buildPostSearchParams({ threadId: 42 });
			expect(params.threadId).toBe(42);
		});

		it("omits undefined threadId", () => {
			const params = buildPostSearchParams({});
			expect(params.threadId).toBeUndefined();
		});

		it("includes authorName when non-empty", () => {
			const params = buildPostSearchParams({ authorName: "john" });
			expect(params.authorName).toBe("john");
		});

		it("omits empty authorName", () => {
			const params = buildPostSearchParams({ authorName: "" });
			expect(params.authorName).toBeUndefined();
		});

		it("includes content filter", () => {
			const params = buildPostSearchParams({ content: "hello" });
			expect(params.content).toBe("hello");
		});

		it("includes sort", () => {
			const params = buildPostSearchParams({ sort: "position_asc" });
			expect(params.sort).toBe("position_asc");
		});
	});
});
