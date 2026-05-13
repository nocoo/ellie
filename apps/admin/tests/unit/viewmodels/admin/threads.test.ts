import {
	buildThreadSearchParams,
	buildThreadsListQuery,
	digestLabel,
	emptyThreadsListFilters,
	forumNameById,
	parseThreadsListQuery,
	stickyLabel,
} from "@/viewmodels/admin/threads";
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

		// Phase H.2 — list page now offers an `authorName` search input and
		// a `forumId` select. Pin the passthrough so a future filter
		// refactor can't quietly drop these without tripping the test.
		it("passes authorName through when non-empty (worker `like` filter)", () => {
			expect(buildThreadSearchParams({ authorName: "alice" }).authorName).toBe("alice");
		});

		it("passes forumId through as a number (worker `exact int` filter)", () => {
			expect(buildThreadSearchParams({ forumId: 42 }).forumId).toBe(42);
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

	// Phase H.2 — list-row forum column resolves the flat forum list
	// client-side. The fallback to "#<id>" is intentional and must hold
	// across an empty list (page rendered before fetch settled) and an
	// unknown id (forum since hidden / deleted), so the column never
	// renders empty.
	describe("forumNameById", () => {
		const forums = [
			{ id: 1, name: "公告" },
			{ id: 5, name: "技术讨论" },
		];

		it("returns the forum name when id is present", () => {
			expect(forumNameById(forums, 5)).toBe("技术讨论");
		});

		it('falls back to "#<id>" when id is missing from the list', () => {
			expect(forumNameById(forums, 99)).toBe("#99");
		});

		it('falls back to "#<id>" when the forum list is empty', () => {
			expect(forumNameById([], 7)).toBe("#7");
		});
	});

	// Phase H.3.1 — list page persists filter state to URL so breadcrumbs
	// (and shareable links / back-forward) actually apply the filter on
	// arrival. Two pure functions live in the viewmodel so the URL contract
	// is testable without rendering React + Next router.
	describe("parseThreadsListQuery", () => {
		const sp = (entries: Record<string, string>) => ({
			get: (key: string) => (key in entries ? entries[key] : null),
		});

		it("returns empty filters when no keys are present", () => {
			expect(parseThreadsListQuery(sp({}))).toEqual(emptyThreadsListFilters());
		});

		it("reads forumId from the query (matches breadcrumb link target)", () => {
			expect(parseThreadsListQuery(sp({ forumId: "5" })).forumId).toBe("5");
		});

		it("reads every known filter key", () => {
			const f = parseThreadsListQuery(
				sp({
					search: "hello",
					authorName: "alice",
					forumId: "5",
					sticky: "1",
					digest: "2",
					closed: "1",
					highlighted: "0",
				}),
			);
			expect(f).toEqual({
				search: "hello",
				authorName: "alice",
				forumId: "5",
				sticky: "1",
				digest: "2",
				closed: "1",
				highlighted: "0",
			});
		});

		it('treats empty string values as "not set" (drops back to "")', () => {
			expect(parseThreadsListQuery(sp({ forumId: "" })).forumId).toBe("");
		});

		it("ignores unknown query keys", () => {
			const f = parseThreadsListQuery(sp({ forumId: "5", evil: "drop tables" }));
			expect(f.forumId).toBe("5");
			expect((f as Record<string, unknown>).evil).toBeUndefined();
		});
	});

	describe("buildThreadsListQuery", () => {
		it("omits empty filters entirely", () => {
			expect(buildThreadsListQuery(emptyThreadsListFilters())).toEqual({});
		});

		it("emits only the set filters", () => {
			expect(
				buildThreadsListQuery({
					...emptyThreadsListFilters(),
					forumId: "5",
					authorName: "alice",
				}),
			).toEqual({ forumId: "5", authorName: "alice" });
		});

		it("round-trips with parseThreadsListQuery", () => {
			const filters = {
				...emptyThreadsListFilters(),
				search: "hello",
				forumId: "5",
				highlighted: "1",
			};
			const flat = buildThreadsListQuery(filters);
			const params = new URLSearchParams(flat);
			expect(parseThreadsListQuery(params)).toEqual(filters);
		});
	});
});
