import { describe, expect, it } from "vitest";
import { mapThreadRows } from "../../../src/handlers/thread";

// Anchor row used by every test; properties not under test are fixed defaults.
function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 1058149,
		forum_id: 335,
		author_id: 340271,
		author_name: "小牧童",
		subject: "日本风俗店体验",
		created_at: 1367326318,
		last_post_at: 1370000000,
		last_poster: "batlet",
		last_poster_id: 445134,
		replies: 30,
		views: 5000,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		type_name: "",
		// Defaults — overrides flip them per test.
		anonymous_author: 0,
		anonymous_last_poster: 0,
		...overrides,
	};
}

describe("thread.mapThreadRows — anonymous masking (mig 0048)", () => {
	describe("KV-cache fast path (avatars come from user-cache enrichment)", () => {
		it("masks anonymous author for an anonymous viewer", () => {
			const out = mapThreadRows([makeRow({ anonymous_author: 1 })], true, null);
			expect(out[0].authorId).toBe(0);
			expect(out[0].authorName).toBe("匿名");
			expect(out[0].anonymousAuthor).toBe(1);
			// last poster untouched
			expect(out[0].lastPosterId).toBe(445134);
		});

		it("unmasks for the original author (self)", () => {
			const out = mapThreadRows([makeRow({ anonymous_author: 1 })], true, {
				userId: 340271,
				role: 0,
			});
			expect(out[0].authorId).toBe(340271);
			expect(out[0].authorName).toBe("小牧童");
		});

		it("unmasks for staff (Mod)", () => {
			const out = mapThreadRows([makeRow({ anonymous_author: 1 })], true, {
				userId: 999,
				role: 3,
			});
			expect(out[0].authorId).toBe(340271);
		});

		it("masks anonymous last poster for non-staff non-self", () => {
			const out = mapThreadRows([makeRow({ anonymous_last_poster: 1 })], true, {
				userId: 999,
				role: 0,
			});
			expect(out[0].lastPosterId).toBe(0);
			expect(out[0].lastPoster).toBe("匿名");
			expect(out[0].anonymousLastPoster).toBe(1);
		});

		it("unmasks last poster for the original last poster (self)", () => {
			const out = mapThreadRows([makeRow({ anonymous_last_poster: 1 })], true, {
				userId: 445134,
				role: 0,
			});
			expect(out[0].lastPosterId).toBe(445134);
			expect(out[0].lastPoster).toBe("batlet");
		});

		it("does not mask non-anonymous threads", () => {
			const out = mapThreadRows([makeRow()], true, null);
			expect(out[0].authorId).toBe(340271);
			expect(out[0].lastPosterId).toBe(445134);
			expect(out[0].anonymousAuthor).toBe(0);
			expect(out[0].anonymousLastPoster).toBe(0);
		});
	});

	describe("JOIN fast path (avatars come from the row itself)", () => {
		it("strips the joined avatar columns when the author is masked", () => {
			const out = mapThreadRows(
				[
					makeRow({
						anonymous_author: 1,
						author_avatar: "real.jpg",
						author_avatar_path: "/real.jpg",
						last_poster_avatar: "lp.jpg",
						last_poster_avatar_path: "/lp.jpg",
					}),
				],
				false,
				null,
			);
			expect(out[0].authorAvatar).toBe("");
			expect(out[0].authorAvatarPath).toBe("");
			// last poster wasn't anonymous → keep its avatar
			expect(out[0].lastPosterAvatar).toBe("lp.jpg");
		});

		it("strips last_poster avatar when last_poster is masked", () => {
			const out = mapThreadRows(
				[
					makeRow({
						anonymous_last_poster: 1,
						author_avatar: "a.jpg",
						author_avatar_path: "/a.jpg",
						last_poster_avatar: "real-lp.jpg",
						last_poster_avatar_path: "/real-lp.jpg",
					}),
				],
				false,
				null,
			);
			expect(out[0].authorAvatar).toBe("a.jpg");
			expect(out[0].lastPosterAvatar).toBe("");
			expect(out[0].lastPosterAvatarPath).toBe("");
		});

		it("preserves both avatars for non-anonymous rows", () => {
			const out = mapThreadRows(
				[
					makeRow({
						author_avatar: "a.jpg",
						author_avatar_path: "/a.jpg",
						last_poster_avatar: "lp.jpg",
						last_poster_avatar_path: "/lp.jpg",
					}),
				],
				false,
				null,
			);
			expect(out[0].authorAvatar).toBe("a.jpg");
			expect(out[0].lastPosterAvatar).toBe("lp.jpg");
		});

		it("staff sees real avatars on an anonymous thread", () => {
			const out = mapThreadRows(
				[
					makeRow({
						anonymous_author: 1,
						author_avatar: "real.jpg",
						author_avatar_path: "/real.jpg",
					}),
				],
				false,
				{ userId: 1, role: 1 },
			);
			expect(out[0].authorId).toBe(340271);
			expect(out[0].authorAvatar).toBe("real.jpg");
		});
	});

	it("treats role 0 (User) as non-staff — only self can unmask", () => {
		const row = makeRow({ anonymous_author: 1 });
		const otherMember = mapThreadRows([row], true, { userId: 999, role: 0 });
		expect(otherMember[0].authorId).toBe(0);
		const self = mapThreadRows([row], true, { userId: 340271, role: 0 });
		expect(self[0].authorId).toBe(340271);
	});
});
