import { describe, expect, it } from "bun:test";
import { digestLabel } from "../../../../apps/web/src/viewmodels/forum/digest";
import { createRepositories, resetStore } from "@ellie/test-mocks";

// ---------------------------------------------------------------------------
// digestLabel
// ---------------------------------------------------------------------------

describe("digestLabel", () => {
	it("returns 精华 for level 1", () => {
		expect(digestLabel(1)).toBe("精华");
	});

	it("returns 精华 II for level 2", () => {
		expect(digestLabel(2)).toBe("精华 II");
	});

	it("returns 精华 III for level 3", () => {
		expect(digestLabel(3)).toBe("精华 III");
	});

	it("returns empty string for level 0", () => {
		expect(digestLabel(0)).toBe("");
	});

	it("returns empty string for unknown levels", () => {
		expect(digestLabel(5)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Digest list loading (integration with mock repository)
// ---------------------------------------------------------------------------

describe("digest list loading", () => {
	it("fetches digest threads from repository", async () => {
		resetStore();
		const repos = createRepositories();
		const result = await repos.threads.list({ digest: true, limit: 50 });

		// All returned threads should have digest > 0
		for (const thread of result.items) {
			expect(thread.digest).toBeGreaterThan(0);
		}
	});

	it("returns paginated result shape", async () => {
		resetStore();
		const repos = createRepositories();
		const result = await repos.threads.list({ digest: true, limit: 2 });

		expect(result).toHaveProperty("items");
		expect(result).toHaveProperty("nextCursor");
		expect(result).toHaveProperty("prevCursor");
		expect(result).toHaveProperty("total");
		expect(Array.isArray(result.items)).toBe(true);
	});
});
