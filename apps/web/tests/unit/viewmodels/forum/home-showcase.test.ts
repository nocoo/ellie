import type { HomeDigestTopic, HomeRecentTopic } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { buildDigestShowcaseItem, buildRecentShowcaseItem } from "@/viewmodels/forum/home-showcase";

const baseDigest: HomeDigestTopic = {
	id: 101,
	forumId: 10,
	forumName: "校园新闻",
	subject: "置顶精华帖",
	digest: 1,
	createdAt: 1700000000,
	replies: 12,
	views: 345,
	anonymousAuthor: 0,
	authorId: 7,
	authorName: "Alice",
	authorAvatarPath: "avatars/7.png",
};

const baseRecent: HomeRecentTopic = {
	id: 202,
	forumId: 20,
	forumName: "灌水专区",
	subject: "最新回复帖",
	lastPostAt: 1700001000,
	replies: 5,
	lastPosterId: 9,
	lastPoster: "Bob",
	lastPosterAvatarPath: "avatars/9.png",
	anonymousLastPoster: 0,
};

describe("buildDigestShowcaseItem", () => {
	it("maps named, anonymous, and unknown authors correctly", () => {
		expect(buildDigestShowcaseItem(baseDigest)).toEqual({
			id: 101,
			subject: "置顶精华帖",
			forumId: 10,
			forumName: "校园新闻",
			digest: 1,
			replies: 12,
			views: 345,
			userId: 7,
			userName: "Alice",
			avatarPath: "avatars/7.png",
			at: 1700000000,
		});

		expect(
			buildDigestShowcaseItem({
				...baseDigest,
				anonymousAuthor: 1,
			}),
		).toMatchObject({
			userId: 0,
			userName: "匿名",
			avatarPath: "",
		});

		expect(
			buildDigestShowcaseItem({
				...baseDigest,
				authorId: 0,
				authorName: "",
			}),
		).toMatchObject({
			userId: 0,
			userName: "未知用户",
		});
	});
});

describe("buildRecentShowcaseItem", () => {
	it("maps named, anonymous, and unknown last posters correctly", () => {
		expect(buildRecentShowcaseItem(baseRecent)).toEqual({
			id: 202,
			subject: "最新回复帖",
			forumId: 20,
			forumName: "灌水专区",
			digest: 0,
			replies: 5,
			userId: 9,
			userName: "Bob",
			avatarPath: "avatars/9.png",
			at: 1700001000,
		});

		expect(
			buildRecentShowcaseItem({
				...baseRecent,
				anonymousLastPoster: 1,
			}),
		).toMatchObject({
			userId: 0,
			userName: "匿名",
			avatarPath: "",
		});

		expect(
			buildRecentShowcaseItem({
				...baseRecent,
				lastPosterId: 0,
				lastPoster: "",
			}),
		).toMatchObject({
			userId: 0,
			userName: "未知用户",
		});
	});
});
