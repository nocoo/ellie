import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { fetchDigestList } from "@/viewmodels/forum/digest";

describe("digest ViewModel", () => {
	describe("fetchDigestList", () => {
		test("returns paginated result", async () => {
			const repos = createRepositories();
			const result = await fetchDigestList(repos);
			expect(Array.isArray(result.items)).toBe(true);
			expect(typeof result.total).toBe("number");
		});

		test("all returned items are digest threads", async () => {
			const repos = createRepositories();
			const result = await fetchDigestList(repos);
			for (const item of result.items) {
				expect(item.thread.digest).toBeGreaterThan(0);
			}
		});

		test("items are enriched with badges", async () => {
			const repos = createRepositories();
			const result = await fetchDigestList(repos);
			for (const item of result.items) {
				expect(Array.isArray(item.badges)).toBe(true);
				// Digest threads should have at least a digest badge
				const digestBadge = item.badges.find((b) => b.type === "digest");
				expect(digestBadge).toBeDefined();
			}
		});

		test("respects limit parameter", async () => {
			const repos = createRepositories();
			const result = await fetchDigestList(repos, { limit: 1 });
			expect(result.items.length).toBeLessThanOrEqual(1);
		});
	});
});
